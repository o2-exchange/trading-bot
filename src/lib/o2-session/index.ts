import { Address, bn } from 'fuels';
import type { Account, B256Address } from 'fuels';
import { pad } from 'viem';

import { NETWORKS, DEFAULT_SESSION_DURATION_SECONDS } from './config';
import { FuelSessionSigner } from './session-signer';
import { TradeAccountManager } from './trade-account-manager';
import { O2ApiClient } from './api';
import type { NetworkName, O2SessionConfig, SessionInput } from './types';

// ─── Re-exports ──────────────────────────────────────────────────────────────

export * from './types';
export * from './config';
export { FuelSessionSigner } from './session-signer';
export { TradeAccountManager } from './trade-account-manager';
export { O2ApiClient } from './api';
export * from './adapters';
export {
  createCallToSign,
  encodeActions,
  createCallContractArg,
  removeBits,
  identityInputToIdentity,
  getAddress,
  getContract,
} from './encoders';

// ─── Convenience functions ───────────────────────────────────────────────────

/**
 * Compute the B256 owner ID used for the `O2-Owner-Id` header.
 *
 * - Fuel addresses are already 32 bytes — passed through directly.
 * - EVM addresses (20 bytes) are left-padded to 32 bytes.
 */
export function computeOwnerIdB256(address: string, isEvm: boolean): string {
  if (isEvm) {
    const paddedAddress = pad(address as `0x${string}`, { size: 32 });
    return Address.fromString(paddedAddress).toB256();
  }
  return Address.fromString(address).toB256();
}

// ─── Session creation params ─────────────────────────────────────────────────

export interface CreateO2SessionParams {
  /** Owner account (from any adapter) */
  account: Account;
  /** Network to use */
  network: NetworkName;
  /** Order book contract IDs the session is allowed to call */
  contractIds: string[];
  /** Session duration in seconds (default: 30 days) */
  sessionDurationSeconds?: number;
  /** Existing session signer private key to restore (optional) */
  sessionSignerPrivateKey?: string;
  /** Pre-computed B256 owner ID (required) */
  ownerIdB256: string;
  /** Existing trade account ID (optional — will be looked up / created if missing) */
  tradeAccountId?: string;
}

export interface CreateO2SessionResult {
  session: any;
  sessionSigner: FuelSessionSigner;
  tradeAccountId: string;
  tradeAccountManager: TradeAccountManager;
  api: O2ApiClient;
  ownerIdB256: string;
}

/**
 * Full sponsored session creation flow:
 *
 * 1. Get or create trading account
 * 2. Generate session signer (or restore from private key)
 * 3. Create TradeAccountManager
 * 4. Fetch nonce from API
 * 5. Sign session params with owner account
 * 6. Submit to O2 API
 * 7. Return everything needed for trading
 */
export async function createO2Session(params: CreateO2SessionParams): Promise<CreateO2SessionResult> {
  const {
    account,
    network,
    contractIds,
    sessionDurationSeconds = DEFAULT_SESSION_DURATION_SECONDS,
    sessionSignerPrivateKey,
    ownerIdB256,
    tradeAccountId: existingTradeAccountId,
  } = params;

  const config = NETWORKS[network];
  const api = new O2ApiClient(config.apiUrl);

  // 1. Get or create trading account
  let tradeAccountId = existingTradeAccountId;
  if (!tradeAccountId) {
    const accountResponse = await api.getAccountByOwner(ownerIdB256);
    if (accountResponse.trade_account_id) {
      tradeAccountId = accountResponse.trade_account_id;
    } else {
      const createResponse = await api.createTradingAccount(
        { identity: { Address: ownerIdB256 } },
        ownerIdB256
      );
      tradeAccountId = createResponse.trade_account_id;
    }
  }

  // 2. Generate or restore session signer
  const sessionSigner = new FuelSessionSigner(
    sessionSignerPrivateKey as B256Address | undefined
  );

  // 3. Create TradeAccountManager
  const tradeAccountManager = new TradeAccountManager({
    signer: sessionSigner,
    account,
    tradeAccountId: tradeAccountId as B256Address,
  });

  // 4. Fetch nonce from API
  await tradeAccountManager.fetchNonceFromAPI(tradeAccountId!, ownerIdB256, api);

  // 5. Sign session params with owner account
  const expirySeconds = Math.floor(Date.now() / 1000) + sessionDurationSeconds;
  const sessionParams = await tradeAccountManager.api_CreateSessionParams(
    contractIds,
    expirySeconds
  );

  // 6. Submit to O2 API
  const session = await api.createSession(sessionParams, ownerIdB256);

  // 7. Set session on manager and increment nonce
  tradeAccountManager.setSession({
    session_id: { Address: { bits: sessionSigner.address.toB256() } },
    expiry: { unix: bn(expirySeconds.toString()) },
    contract_ids: contractIds.map((id) => ({ bits: id })),
  });
  tradeAccountManager.incrementNonce();

  return {
    session,
    sessionSigner,
    tradeAccountId: tradeAccountId!,
    tradeAccountManager,
    api,
    ownerIdB256,
  };
}

// ─── Session restoration params ──────────────────────────────────────────────

export interface RestoreO2SessionParams {
  /** Owner account (from any adapter) */
  account: Account;
  /** Network to use */
  network: NetworkName;
  /** Order book contract IDs the session is allowed to call */
  contractIds: string[];
  /** Session signer private key (required for restore) */
  sessionSignerPrivateKey: string;
  /** Trade account ID (required for restore) */
  tradeAccountId: string;
  /** Pre-computed B256 owner ID */
  ownerIdB256: string;
  /** Session expiry in seconds since epoch */
  sessionExpirySeconds: number;
}

export interface RestoreO2SessionResult {
  sessionSigner: FuelSessionSigner;
  tradeAccountManager: TradeAccountManager;
  api: O2ApiClient;
  ownerIdB256: string;
}

/**
 * Restore an existing session for trading actions.
 *
 * Use this when you have a persisted `sessionSigner.privateKey` and
 * `tradeAccountId` from a previous `createO2Session` call.
 */
export async function restoreO2Session(params: RestoreO2SessionParams): Promise<RestoreO2SessionResult> {
  const {
    account,
    network,
    contractIds,
    sessionSignerPrivateKey,
    tradeAccountId,
    ownerIdB256,
    sessionExpirySeconds,
  } = params;

  const config = NETWORKS[network];
  const api = new O2ApiClient(config.apiUrl);

  const sessionSigner = new FuelSessionSigner(sessionSignerPrivateKey as B256Address);

  const tradeAccountManager = new TradeAccountManager({
    signer: sessionSigner,
    account,
    tradeAccountId: tradeAccountId as B256Address,
  });

  // Restore session state
  tradeAccountManager.setSession({
    session_id: { Address: { bits: sessionSigner.address.toB256() } },
    expiry: { unix: bn(sessionExpirySeconds.toString()) },
    contract_ids: contractIds.map((id) => ({ bits: id })),
  });

  // Fetch current nonce from API
  await tradeAccountManager.fetchNonceFromAPI(tradeAccountId, ownerIdB256, api);

  return {
    sessionSigner,
    tradeAccountManager,
    api,
    ownerIdB256,
  };
}
