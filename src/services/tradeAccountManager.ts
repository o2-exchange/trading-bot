import { Account, BN, Address, FunctionInvocationScope, concat, BigNumberCoder, hexlify, sha256 } from 'fuels';
import { bn } from 'fuels';

import { createCallToSign, getContract, getAddress, createCallContractArg, removeBits } from '../utils/o2/o2Encoders';

import { TradeAccount } from '../types/contracts/TradeAccount';
import {
  BigInterish,
  API_CreateSessionRequest,
  SessionSigner,
  TradeAccountManagerConfig,
  API_SessionCallContractRequest,
} from '../types/o2ApiTypes';
import { IdentityInput, SessionInput } from '../types/contracts/TradeAccount';

const GAS_LIMIT_DEFAULT = bn('18446744073709551615');

export class TradeAccountManager {
  readonly account: Account;
  readonly signer: SessionSigner;
  readonly contract: TradeAccount;
  readonly defaultGasLimit: BN;

  private _nonce: BN = bn(0);
  private session!: SessionInput;

  constructor(config: TradeAccountManagerConfig) {
    this.account = config.account;
    if (!config.tradeAccountId) {
      throw new Error('tradeAccountId must be defined');
    }
    this.contract = new TradeAccount(config.tradeAccountId, this.account);
    this.signer = config.signer;
    this.defaultGasLimit = config.defaultGasLimit ? bn(config.defaultGasLimit.toString()) : GAS_LIMIT_DEFAULT;
  }

  get nonce(): BN {
    return this._nonce;
  }

  get contractId(): Address {
    return this.contract.id;
  }

  get identity(): IdentityInput {
    return getContract(this.contract.id);
  }

  get signerAddress(): Address {
    return this.signer.address;
  }

  get signerIdentity(): IdentityInput {
    return getAddress(this.signer.address);
  }

  get ownerAddress() {
    return this.account.address;
  }

  async recoverSession() {
    const { value } = await this.contract.functions.get_current_session().get();
    if (!value) {
      throw new Error('Session not found');
    }
    this.session = value as SessionInput;
    return this.session;
  }

  setSession(session: SessionInput) {
    this.session = session;
  }

  /**
   * Creates a new session directly on-chain (non-sponsored flow)
   * This bypasses the API signature issue by using transaction signing
   * instead of message signing. The wallet connector supports transaction signing.
   * 
   * @param contract_ids - Array of contract IDs the session is allowed to interact with
   * @param expiry - Session expiry timestamp in seconds (Unix timestamp)
   * @returns The created session
   */
  async newSession(contract_ids: string[], expiry?: BigInterish): Promise<SessionInput> {
    console.log('[TradeAccountManager] Creating session on-chain (non-sponsored flow)...')
    
    // IMPORTANT: expiry must be in SECONDS (Unix timestamp)
    const expiryInSeconds = expiry 
      ? (typeof expiry === 'number' && Number(expiry) > 10000000000 ? Math.floor(Number(expiry) / 1000) : Number(expiry))
      : Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    
    const session: SessionInput = {
      session_id: getAddress(this.signer.address),
      expiry: {
        unix: bn(expiryInSeconds.toString()),
      },
      contract_ids: contract_ids.map((id) => ({ bits: id })),
    };
    
    console.log('[TradeAccountManager] Session data:', {
      session_id: this.signer.address.toB256(),
      expiry: expiryInSeconds,
      contract_ids_count: contract_ids.length,
    })
    
    // Call set_session on-chain (this uses transaction signing, not message signing)
    // The wallet connector supports transaction signing without the prefix issue
    console.log('[TradeAccountManager] Calling set_session on-chain...')
    const result = await this.contract.functions
      .set_session(undefined, session)  // undefined = no signature needed for direct call
      .call()
      .then((res) => res.waitForResult());
    
    console.log('[TradeAccountManager] Session created on-chain, tx:', result.transactionId)
    
    this.session = session;
    this.incrementNonce();
    
    return session;
  }

  /**
   * Validates the current session on-chain
   * Returns true if session is still valid, false if revoked/expired
   * CRITICAL: This makes an on-chain call to check session validity
   */
  async validateSession(): Promise<boolean> {
    try {
      if (!this.session) {
        console.log('[TradeAccountManager] No session to validate')
        return false
      }

      // Call on-chain validate_session function
      const { value } = await this.contract.functions
        .validate_session(getAddress(this.signerAddress))
        .get()

      console.log('[TradeAccountManager] Session validation result:', value)
      return value
    } catch (error) {
      console.error('[TradeAccountManager] Session validation failed:', error)
      return false
    }
  }

  async fetchNonce() {
    // Fetch nonce from chain (fallback if API not available)
    const { value } = await this.contract.functions.get_nonce().get();
    this._nonce = value;
    return this._nonce;
  }

  async fetchNonceFromAPI(tradeAccountId: string, ownerId: string, o2ApiService: any): Promise<BN> {
    // Fetch nonce from API endpoint (matching O2 frontend behavior)
    const account = await o2ApiService.getAccount(tradeAccountId, ownerId);
    this._nonce = bn(account.nonce);
    return this._nonce;
  }

  setNonce(nonce: BigInterish) {
    this._nonce = bn(nonce.toString());
  }

  incrementNonce() {
    this._nonce = this._nonce.add(bn(1));
    return this._nonce;
  }

  async signBytesWithSession(bytes: Uint8Array, length?: number) {
    if (!this.signer) {
      throw new Error('Session not initialized');
    }
    const byteToSign = [new BigNumberCoder('u64').encode(this.nonce)];
    if (length) {
      byteToSign.push(new BigNumberCoder('u64').encode(length));
    }
    byteToSign.push(bytes);
    return this.signer.sign(concat(byteToSign));
  }

  async api_CreateSessionParams(contract_ids: string[], expiry?: BigInterish): Promise<API_CreateSessionRequest> {
    // Required
    if (!contract_ids || contract_ids.length === 0) {
      throw new Error('session must specify at least one allowed contract');
    }
    // Format
    // IMPORTANT: expiry must be in SECONDS (Unix timestamp), not milliseconds!
    // O2 app uses: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
    const expiryInSeconds = expiry 
      ? (typeof expiry === 'number' && expiry > 10000000000 ? Math.floor(Number(expiry) / 1000) : Number(expiry))
      : Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    
    const session = {
      session_id: getAddress(this.signer.address),
      expiry: {
        unix: bn(expiryInSeconds.toString()),
      },
      contract_ids: contract_ids.map((id) => ({ bits: id })),
    };
    const chainId = await this.account.provider.getChainId();
    const bytesToSign = await createCallToSign(
      this.nonce,
      chainId,
      this.contract.functions.set_session(undefined, session)
    );

    // Sign using personalSign option (exactly like O2 app does)
    // The FuelAccountAdapter will handle conversion for connector wallets
    console.log('[TradeAccountManager] Signing with personalSign, bytes length:', bytesToSign.length);
    console.log('[TradeAccountManager] Account constructor:', this.account?.constructor?.name);
    const signatureHex = await this.account.signMessage({
      personalSign: bytesToSign,
    });
    // FuelWalletAdapter already returns hex string, don't call hexlify again
    // (matches O2 reference: signature is used directly from signMessage)
    return {
      nonce: this.nonce.toString(),
      contract_id: this.contract.id.toB256(),
      contract_ids,
      session_id: {
        Address: this.signer.address.toB256(),
      },
      signature: {
        Secp256k1: signatureHex,
      },
      expiry: bn(session.expiry.unix).toString(),
    };
  }

  async api_SessionCallContractsParams(
    invocationScopes: Array<FunctionInvocationScope<any>>
  ): Promise<API_SessionCallContractRequest> {
    if (!this.session) {
      throw new Error('Session not initialized');
    }
    const callContracts = invocationScopes.map((call) => createCallContractArg(call, this.defaultGasLimit));
    const bytesToSign = concat(callContracts.map((call) => call.callContractArgBytes));
    const signature = await this.signBytesWithSession(bytesToSign, callContracts.length);
    const calls = callContracts.map(({ callContractArg }) => ({
      contract_id: removeBits(callContractArg.contract_id),
      function_selector: hexlify(callContractArg.function_selector),
      call_params: {
        coins: callContractArg.call_params.coins.toString(),
        asset_id: removeBits(callContractArg.call_params.asset_id),
        gas: callContractArg.call_params.gas.toString(),
      },
      call_data: callContractArg.call_data ? hexlify(callContractArg.call_data) : undefined,
    }));
    const variableOutputs = callContracts.reduce((acc, call) => {
      return acc + (call.variableOutputs || 0);
    }, 0);
    return {
      nonce: this.nonce.toString(),
      session_id: removeBits(this.signerIdentity),
      trade_account_id: this.contractId.toB256(),
      signature: removeBits(signature, true),
      calls,
      variable_outputs: variableOutputs,
      min_gas_limit: '20000000', // Matches O2 frontend
    };
  }
}

