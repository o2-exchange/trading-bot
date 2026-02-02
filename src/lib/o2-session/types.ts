/**
 * Self-contained type definitions for O2 session module.
 * Only depends on `fuels` SDK types.
 */

import type {
  Address,
  B256Address,
  BigNumberish,
  BN,
  Bytes,
  FunctionInvocationScope,
  AbstractContract,
} from 'fuels';

// ─── Sway-compatible utility types ───────────────────────────────────────────

export type Enum<T> = {
  [K in keyof T]: Pick<T, K> & { [P in Exclude<keyof T, K>]?: never };
}[keyof T];

export type Option<T> = T | undefined;

export type Vec<T> = T[];

// ─── Contract types (from TradeAccount ABI) ──────────────────────────────────

export type AddressInput = { bits: string };
export type ContractIdInput = { bits: string };
export type AssetIdInput = { bits: string };

export type IdentityInput = Enum<{ Address: AddressInput; ContractId: ContractIdInput }>;

type Secp256k1Input = { bits: BigNumberish[] };
type Secp256r1Input = { bits: BigNumberish[] };
type Ed25519Input = { bits: BigNumberish[] };

export type SignatureInput = Enum<{
  Secp256k1: Secp256k1Input;
  Secp256r1: Secp256r1Input;
  Ed25519: Ed25519Input;
}>;

export type TimeInput = { unix: BigNumberish };

export type SessionInput = {
  session_id: IdentityInput;
  expiry: TimeInput;
  contract_ids: Vec<ContractIdInput>;
};

// ─── Identity type (API-level, string-based) ─────────────────────────────────

export type Identity = Enum<{
  Address: string;
  ContractId: string;
}>;

// ─── API Signature type (hex string based) ───────────────────────────────────

export type Signature = Enum<{
  Secp256k1: string;
  Secp256r1: string;
  Ed25519: string;
}>;

// ─── BigInterish (accepts multiple numeric types) ────────────────────────────

export type BigInterish = BigNumberish | bigint | BN;

// ─── SessionSigner interface ─────────────────────────────────────────────────

export interface SessionSigner {
  address: Address;
  sign(data: Uint8Array): Promise<SignatureInput>;
}

// ─── Order types ─────────────────────────────────────────────────────────────

export enum OrderType {
  Spot = 'Spot',
  Market = 'Market',
  Limit = 'Limit',
  FillOrKill = 'FillOrKill',
  PostOnly = 'PostOnly',
}

export enum OrderSide {
  Buy = 'Buy',
  Sell = 'Sell',
}

export type OrderBookConfig = {
  baseAssetId: B256Address;
  quoteAssetId: B256Address;
  baseDecimals: number;
  quoteDecimals: number;
};

// ─── Session action types ────────────────────────────────────────────────────

export interface CancelOrderAction {
  CancelOrder: {
    order_id: `0x${string}`;
  };
}

export interface CreateOrderAction {
  CreateOrder: {
    side: OrderSide;
    order_type: OrderType;
    price: string;
    quantity: string;
  };
}

export interface SettleBalanceAction {
  SettleBalance: {
    to: Identity;
  };
}

export type SessionAction = CancelOrderAction | CreateOrderAction | SettleBalanceAction;

// ─── Session call contract arg ───────────────────────────────────────────────

export interface SessionCallContractArg {
  contractId: string;
  functionSelector: string;
  amount: BN;
  assetId: string;
  gas: BN;
  args?: Uint8Array;
}

// ─── TradeAccountManager config ──────────────────────────────────────────────

export type TradeAccountManagerConfig = {
  signer: SessionSigner;
  account: import('fuels').Account;
  tradeAccountId?: B256Address;
  contractIds?: string[];
  defaultGasLimit?: BigInterish;
};

// ─── API request/response types ──────────────────────────────────────────────

export interface API_CreateSessionRequest {
  readonly nonce: string;
  readonly contract_id: string;
  readonly session_id: Identity;
  readonly contract_ids: string[];
  readonly signature: Signature;
  readonly expiry: string;
}

export interface API_SessionCallContractRequest {
  nonce: string;
  session_id: Identity;
  trade_account_id: B256Address;
  signature: Signature;
  call?: any;
  calls?: any[];
  contracts?: B256Address[];
  variable_outputs: number;
  min_gas_limit?: string;
}

export interface CreateTradingAccountRequest {
  identity: {
    Address: string;
  };
}

export interface CreateTradingAccountResponse {
  trade_account_id: string;
}

export interface GetAccountResponse {
  trade_account: {
    nonce: number;
    owner: {
      Address?: string;
      ContractId?: string;
    };
    synced_with_network: boolean;
  } | null;
  trade_account_id: string | null;
}

// ─── Network config types ────────────────────────────────────────────────────

export type NetworkName = 'mainnet' | 'testnet';

export interface NetworkConfig {
  name: NetworkName;
  apiUrl: string;
  fuelRpcUrl: string;
  contracts: {
    tradeAccountRegistry: string;
    tradeAccountOracle: string;
    orderBookRegistry: string;
    orderBookWhitelist: string;
    orderBookBlacklist: string;
  };
  assets: {
    FUEL: string;
    USDC: string;
    ETH: string;
    USDT: string;
    MOOR: string;
    wBTC: string;
  };
}

// ─── O2 session config ──────────────────────────────────────────────────────

export interface O2SessionConfig {
  network: NetworkName;
  contractIds: string[];
  sessionDurationSeconds?: number;
}
