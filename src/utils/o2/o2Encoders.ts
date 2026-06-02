import {
  Address,
  B256Address,
  FunctionInvocationScope,
  BigNumberCoder,
  concat,
  arrayify,
  bn,
  BN,
  ZeroBytes32,
  AbstractContract,
  hexlify,
} from 'fuels';
import { toUtf8Bytes } from 'ethers';

import type { OrderTypeInput, OrderBook } from '../../types/contracts/OrderBook';
import type { IdentityInput } from '../../types/contracts/TradeAccount';
import type { BigInterish, OrderBookConfig, SessionAction, SessionCallContractArg } from '../../types/o2ApiTypes';
import { OrderType, OrderSide, CreateOrderAction } from '../../types/o2ApiTypes';
import { Identity } from '../../types/o2-api-types';

export function createCallToSign(
  nonce: BigInterish,
  chainId: BigInterish,
  invocationScope: FunctionInvocationScope<any>
) {
  const callConfig = invocationScope.getCallConfig();
  if (callConfig.func.jsonFn.inputs[0].name !== 'signature') {
    throw new Error(
      'TradeAccountManager.createCallToSign can only be used for functions with signature as the first argument'
    );
  }
  let argBytes = callConfig.func.encodeArguments(callConfig.args);
  const [option] = new BigNumberCoder('u64').decode(argBytes.slice(0, 8), 0);
  if (!option.isZero()) {
    argBytes = argBytes.slice(8 + 64);
  } else {
    argBytes = argBytes.slice(8);
  }
  const funcNameBytes = toUtf8Bytes(callConfig.func.jsonFn.name);
  const finalBytes = concat([
    new BigNumberCoder('u64').encode(bn(nonce.toString())),
    new BigNumberCoder('u64').encode(bn(chainId.toString())),
    new BigNumberCoder('u64').encode(funcNameBytes.length),
    funcNameBytes,
    argBytes,
  ]);
  return arrayify(finalBytes);
}

/**
 * Compute the [minPrice, maxPrice] band the o2 API expects for a
 * BoundedMarket order, given a reference price and a slippage tolerance
 * (decimal fraction, e.g. 0.1 = 10%). Defaults to 10% when unspecified.
 *
 * Used both for the on-chain encoded order_type and for the wire-format
 * JSON the session/actions API expects, so the two stay in sync.
 */
export function computeBoundedBand(
  price: string,
  slippage: number = 0.1
): { minPrice: string; maxPrice: string } {
  const SCALE = 1_000_000n;
  const upScale = BigInt(Math.floor((1 + slippage) * Number(SCALE)));
  const downScale = BigInt(Math.floor((1 - slippage) * Number(SCALE)));
  const refBig = BigInt(bn(price.toString()).toString());
  const minPriceBig = (refBig * downScale) / SCALE;
  const maxPriceBig = (refBig * upScale) / SCALE;
  return { minPrice: minPriceBig.toString(), maxPrice: maxPriceBig.toString() };
}

/**
 * Convert a `CreateOrder` session action to the wire shape the
 * `/session/actions` API expects. For BoundedMarket the API wants a
 * struct variant `{ BoundedMarket: { max_price, min_price } }` rather
 * than the string enum + sibling `slippage_tolerance` we carry in our
 * internal types. All other order types pass through unchanged.
 */
function toWireAction(action: SessionAction): SessionAction {
  if (!('CreateOrder' in action)) return action;
  const co = action.CreateOrder;
  if (co.order_type !== OrderType.BoundedMarket) return action;
  const { minPrice, maxPrice } = computeBoundedBand(co.price, co.slippage_tolerance);
  return {
    CreateOrder: {
      side: co.side,
      order_type: { BoundedMarket: { max_price: maxPrice, min_price: minPrice } } as any,
      price: co.price,
      quantity: co.quantity,
    },
  } as any;
}

export async function encodeActions(
  tradeAccountIdentity: IdentityInput,
  orderBook: OrderBook,
  orderBookConfig: OrderBookConfig,
  actions: SessionAction[] = [],
  gasLimit: BN
): Promise<{ invokeScopes: Array<FunctionInvocationScope<any>>; actions: SessionAction[] }> {
  const invokeScopes: Array<FunctionInvocationScope<any>> = [];
  const newActions: Array<SessionAction> = [];

  const hasCreateOrder = actions.some((action) => 'CreateOrder' in action);

  // CRITICAL: Add SettleBalance BEFORE CreateOrder (matching O2 frontend)
  // This settles any unlocked funds from the orderbook back to the trading account
  // so they can be used for the new order
  if (hasCreateOrder) {
    invokeScopes.push(orderBook.functions.settle_balance(tradeAccountIdentity));
    newActions.push({
      SettleBalance: {
        to: identityInputToIdentity(tradeAccountIdentity),
      },
    });
  }

  // Process the main actions
  for (const action of actions) {
    if ('CreateOrder' in action) {
      invokeScopes.push(createOrderInvokeScope(action, orderBook, orderBookConfig, gasLimit));
      // Convert to wire shape — BoundedMarket gets serialised as a struct
      // variant with explicit min/max prices, everything else is passthrough.
      newActions.push(toWireAction(action));
    } else if ('CancelOrder' in action) {
      invokeScopes.push(orderBook.functions.cancel_order(action.CancelOrder.order_id));
      newActions.push(action);
    } else if ('SettleBalance' in action) {
      invokeScopes.push(orderBook.functions.settle_balance(tradeAccountIdentity));
      newActions.push({
        SettleBalance: {
          to: identityInputToIdentity(tradeAccountIdentity),
        },
      });
    } else {
      throw new Error(`Unsupported action type: ${JSON.stringify(action)}`);
    }
  }

  // Add SettleBalance AFTER CreateOrder as well (matching O2 frontend)
  if (hasCreateOrder) {
    invokeScopes.push(orderBook.functions.settle_balance(tradeAccountIdentity));
    newActions.push({
      SettleBalance: {
        to: identityInputToIdentity(tradeAccountIdentity),
      },
    });
  }

  return { invokeScopes, actions: newActions };
}

export function getContract(bits: B256Address | Address) {
  return { ContractId: getBits(bits) };
}

export function getAddress(bits: B256Address | Address) {
  return { Address: getBits(bits) };
}

function getBits(bits: B256Address | Address) {
  return { bits: bits.toString() };
}

function getOption(args?: Uint8Array) {
  if (args) {
    return concat([new BigNumberCoder('u64').encode(1), args]);
  }
  return new BigNumberCoder('u64').encode(0);
}

function createOrderArgs(createOrder: CreateOrderAction, bookConfig: OrderBookConfig, gasLimit: BN) {
  let order_type: OrderTypeInput;
  switch (createOrder.CreateOrder.order_type) {
    case OrderType.Limit:
      order_type = { Limit: [] };
      break;
    case OrderType.Spot:
      order_type = { Spot: undefined };
      break;
    case OrderType.Market:
      order_type = { Market: undefined };
      break;
    case OrderType.FillOrKill:
      order_type = { FillOrKill: undefined };
      break;
    case OrderType.PostOnly:
      order_type = { PostOnly: undefined };
      break;
    case OrderType.BoundedMarket: {
      const { minPrice, maxPrice } = computeBoundedBand(
        createOrder.CreateOrder.price,
        createOrder.CreateOrder.slippage_tolerance
      );
      order_type = { BoundedMarket: [bn(minPrice), bn(maxPrice)] };
      break;
    }
    default:
      throw new Error(`Unsupported order type: ${createOrder.CreateOrder.order_type}`);
  }

  return {
    call_data: {
      price: bn(createOrder.CreateOrder.price.toString()),
      quantity: bn(createOrder.CreateOrder.quantity.toString()),
      order_type,
    },
    call_params: {
      forward: {
        assetId:
          createOrder.CreateOrder.side === OrderSide.Buy
            ? (bookConfig.quoteAssetId as `0x${string}`)
            : (bookConfig.baseAssetId as `0x${string}`),
        amount: calculateAmount(
          createOrder.CreateOrder.side,
          createOrder.CreateOrder.price,
          createOrder.CreateOrder.quantity,
          bookConfig.baseDecimals
        ),
      },
      gasLimit: gasLimit,
    },
  };
}

export function createCallContractArg(invocationScope: FunctionInvocationScope<any>, gasLimit: BN) {
  const callConfig = invocationScope.getCallConfig();
  const forward = callConfig?.forward || {
    assetId: ZeroBytes32,
    amount: bn(0),
  };
  const variableOutputs = callConfig.txParameters?.variableOutputs || 0;
  const callGasLimit = gasLimit;
  const contract = callConfig.program as AbstractContract;
  const contractId = contract.id.toB256();
  const selectorBytes = callConfig.func.selectorBytes;
  const argBytes = callConfig.func.encodeArguments(callConfig.args);
  return {
    contracts: [contract],
    callContractArgBytes: callContractToBytes({
      contractId,
      functionSelector: hexlify(selectorBytes),
      amount: bn(forward.amount),
      assetId: forward.assetId,
      gas: bn(callGasLimit),
      args: argBytes,
    }),
    callContractArg: {
      contract_id: getBits(contractId),
      function_selector: selectorBytes,
      call_params: {
        coins: bn(forward.amount),
        asset_id: getBits(forward.assetId),
        gas: bn(callGasLimit).toString(),
      },
      call_data: argBytes,
    },
    variableOutputs,
  };
}

export function removeBits(data: any, convertToHex: boolean = false) {
  if (data && typeof data === 'object') {
    if (data.bits) {
      return data.bits;
    }
    for (const key in data) {
      if ('bits' in data[key]) {
        const value = data[key].bits;
        data[key] = value;
        if (convertToHex && value instanceof Array) {
          data[key] = hexlify(Uint8Array.from(value));
        }
      } else if (typeof data[key] === 'object') {
        return removeBits(data[key], convertToHex);
      }
    }
  }
  return data;
}

export function identityInputToIdentity(identityInput: IdentityInput): Identity {
  if (identityInput.Address) {
    return { Address: identityInput.Address.bits };
  }
  if (identityInput.ContractId) {
    return { ContractId: identityInput.ContractId.bits };
  }
  throw new Error('Invalid identity input');
}

export function hexPad(hex: string | null | undefined = ''): `0x${string}` | null {
  if (hex === undefined || hex === null || hex === '') {
    return null;
  }

  if (hex.startsWith('0x')) {
    return hex as `0x${string}`;
  }

  return `0x${hex.toLowerCase()}` as const;
}

function createOrderInvokeScope(
  createOrder: CreateOrderAction,
  orderBook: OrderBook,
  orderBookConfig: OrderBookConfig,
  gasLimit: BN
) {
  const { call_data, call_params } = createOrderArgs(createOrder, orderBookConfig, gasLimit);
  return orderBook.functions.create_order(call_data).callParams(call_params);
}

function callContractToBytes(callContractArg: SessionCallContractArg): Uint8Array {
  return concat([
    callContractArg.contractId,
    new BigNumberCoder('u64').encode(arrayify(callContractArg.functionSelector).length),
    callContractArg.functionSelector,
    new BigNumberCoder('u64').encode(callContractArg.amount),
    arrayify(callContractArg.assetId),
    new BigNumberCoder('u64').encode(callContractArg.gas),
    getOption(
      callContractArg.args
        ? concat([new BigNumberCoder('u64').encode(callContractArg.args?.length || 0), callContractArg.args])
        : undefined
    ),
  ]);
}

function calculateAmount(side: OrderSide, price: BigInterish, quantity: BigInterish, base_decimals: number): BN {
  if (side === OrderSide.Buy) {
    return bn(((BigInt(price.toString()) * BigInt(quantity.toString())) / BigInt(10 ** base_decimals)).toString());
  }
  return bn(quantity.toString());
}

