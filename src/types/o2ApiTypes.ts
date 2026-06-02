import type { Account, B256Address, Address, BN, AbstractContract } from 'fuels';
import { BigNumberish } from 'ethers';
import { FunctionInvocationScope } from 'fuels';
import { Enum } from './contracts/common';
import type { SignatureInput } from './contracts/TradeAccount';
import { Identity } from './o2-api-types';

export type BigInterish = BigNumberish | bigint | BN;

export type Signature = Enum<{
  Secp256k1: string;
  Secp256r1: string;
  Ed25519: string;
}>;

export interface SessionSigner {
  address: Address;
  sign(data: Uint8Array): Promise<SignatureInput>;
}

export enum OrderType {
  Spot = 'Spot',
  Market = 'Market',
  Limit = 'Limit',
  FillOrKill = 'FillOrKill',
  PostOnly = 'PostOnly',
  BoundedMarket = 'BoundedMarket',
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

export type TradeAccountManagerConfig = {
  signer: SessionSigner;
  account: Account;
  tradeAccountId?: B256Address;
  contractIds?: string[];
  defaultGasLimit?: BigInterish;
};

export interface API_CreateSessionRequest {
  readonly nonce: string;
  readonly contract_id: string;
  readonly session_id: Identity;
  readonly contract_ids: string[];
  readonly signature: Signature;
  readonly expiry: string;
}

export interface CancelOrderAction {
  CancelOrder: {
    order_id: `0x${string}`;
  };
}

export interface CreateOrderAction {
  CreateOrder: {
    side: OrderSide;
    /**
     * Internal input form: a unit-variant string (e.g. `'BoundedMarket'`).
     * The encoder converts this to either the on-chain encoded order_type
     * or — for the `/session/actions` API body — the wire struct variant
     * form (`{ BoundedMarket: { max_price, min_price } }`). After that
     * conversion, action records on the wire carry the struct variant, so
     * the type accepts both shapes.
     */
    order_type: OrderType | { BoundedMarket: { max_price: string; min_price: string } };
    price: string;
    quantity: string;
    /**
     * Slippage tolerance as a decimal fraction (e.g. 0.1 = 10%). Only read
     * by the encoder when `order_type === OrderType.BoundedMarket` — the
     * encoder computes a `[price × (1 - slippage), price × (1 + slippage)]`
     * price band that is sent to the API as the struct variant. Ignored
     * for other order types and stripped from the wire body.
     */
    slippage_tolerance?: number;
  };
}

export interface SettleBalanceAction {
  SettleBalance: {
    to: Identity;
  };
}

export type SessionAction = CancelOrderAction | CreateOrderAction | SettleBalanceAction;

export interface SessionCallContractArg {
  contractId: string;
  functionSelector: string;
  amount: BN;
  assetId: string;
  gas: BN;
  args?: Uint8Array;
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

