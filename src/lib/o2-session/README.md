# O2 Session Module

Self-contained module for O2 DEX session creation, signing, and trading — supporting Fuel and EVM wallets, Node.js and browser, mainnet and testnet.

## Architecture

```
index.ts                    ← Public entry point + convenience functions
  ├── types.ts              ← All type definitions (self-contained)
  ├── config.ts             ← Network configs, contract IDs, asset IDs
  ├── api.ts                ← O2 REST API client (axios, no browser deps)
  ├── session-signer.ts     ← FuelSessionSigner (keypair + signing)
  ├── encoders.ts           ← Byte encoding for signing
  ├── trade-account-manager.ts ← Core session creation & action signing
  └── adapters/
      ├── fuel-node.ts      ← Node.js: Fuel wallet from private key
      ├── fuel-browser.ts   ← Browser: Fuel wallet from extension
      ├── evm-node.ts       ← Node.js: EVM wallet from private key (ethers)
      └── evm-browser.ts    ← Browser: EVM wallet from wagmi/MetaMask
```

## Prerequisites

Peer dependencies (already in the project):
- `fuels` — Fuel SDK
- `axios` — HTTP client
- `ethers` — EVM signing (only needed for EVM adapters)
- `viem` — Signature conversion + address padding
- `wagmi` — Browser EVM signing (only needed for `evm-browser` adapter)

## Quick Start

### Fuel Wallet — Node.js

```typescript
import {
  createFuelNodeAccount,
  createO2Session,
  computeOwnerIdB256,
  NETWORKS,
} from '../lib/o2-session';

const account = await createFuelNodeAccount(
  '0xYOUR_FUEL_PRIVATE_KEY',
  NETWORKS.mainnet.fuelRpcUrl
);

const ownerIdB256 = computeOwnerIdB256(account.address.toB256(), false);

const { sessionSigner, tradeAccountManager, api } = await createO2Session({
  account,
  network: 'mainnet',
  contractIds: ['0xORDER_BOOK_CONTRACT_ID'],
  ownerIdB256,
});

// Persist for later restoration:
console.log('Session signer key:', sessionSigner.privateKey);
```

### Fuel Wallet — Browser

```typescript
import {
  createFuelBrowserAccount,
  createO2Session,
  computeOwnerIdB256,
  NETWORKS,
} from '../lib/o2-session';
import { Fuel } from 'fuels';

const fuel = new Fuel({ connectors: [/* your connectors */] });
await fuel.connect();

const account = await createFuelBrowserAccount(fuel, NETWORKS.mainnet.fuelRpcUrl);
const ownerIdB256 = computeOwnerIdB256(account.address.toB256(), false);

const result = await createO2Session({
  account,
  network: 'mainnet',
  contractIds: ['0xORDER_BOOK_CONTRACT_ID'],
  ownerIdB256,
});
```

### EVM Wallet — Node.js

```typescript
import {
  createEvmNodeAccount,
  createO2Session,
  computeOwnerIdB256,
  NETWORKS,
} from '../lib/o2-session';

const account = await createEvmNodeAccount(
  '0xYOUR_EVM_PRIVATE_KEY',
  NETWORKS.mainnet.fuelRpcUrl
);

// EVM addresses need padding
const ownerIdB256 = computeOwnerIdB256('0xYOUR_EVM_ADDRESS', true);

const result = await createO2Session({
  account,
  network: 'mainnet',
  contractIds: ['0xORDER_BOOK_CONTRACT_ID'],
  ownerIdB256,
});
```

### EVM Wallet — Browser

```typescript
import {
  createEvmBrowserAccount,
  createO2Session,
  computeOwnerIdB256,
  NETWORKS,
} from '../lib/o2-session';
import { wagmiConfig } from './your-wagmi-config';

const account = await createEvmBrowserAccount(
  '0xUSER_EVM_ADDRESS',
  NETWORKS.mainnet.fuelRpcUrl,
  wagmiConfig
);

const ownerIdB256 = computeOwnerIdB256('0xUSER_EVM_ADDRESS', true);

const result = await createO2Session({
  account,
  network: 'mainnet',
  contractIds: ['0xORDER_BOOK_CONTRACT_ID'],
  ownerIdB256,
});
```

## Restoring a Session

After creating a session, persist `sessionSigner.privateKey`, `tradeAccountId`, and the expiry. Later:

```typescript
import { createFuelNodeAccount, restoreO2Session, NETWORKS } from '../lib/o2-session';

const account = await createFuelNodeAccount(privateKey, NETWORKS.mainnet.fuelRpcUrl);

const { tradeAccountManager, api } = await restoreO2Session({
  account,
  network: 'mainnet',
  contractIds: ['0xORDER_BOOK_CONTRACT_ID'],
  sessionSignerPrivateKey: '0xSAVED_SESSION_SIGNER_KEY',
  tradeAccountId: '0xSAVED_TRADE_ACCOUNT_ID',
  ownerIdB256: computeOwnerIdB256(account.address.toB256(), false),
  sessionExpirySeconds: 1740000000,
});
```

## API Reference

### `computeOwnerIdB256(address, isEvm)`
Computes the B256 owner ID for the `O2-Owner-Id` header. Fuel addresses pass through; EVM addresses are padded to 32 bytes.

### `createO2Session(params) → CreateO2SessionResult`
Full session creation flow: creates trading account → generates signer → signs session → submits to API.

### `restoreO2Session(params) → RestoreO2SessionResult`
Restores an existing session from a persisted signer private key and trade account ID.

### `FuelSessionSigner`
Temporary keypair for session signing. Exposes `privateKey` getter for persistence.

### `TradeAccountManager`
Core class for session creation and action signing. Key methods:
- `api_CreateSessionParams(contractIds, expiry)` — Generate signed session creation request
- `api_SessionCallContractsParams(invocationScopes)` — Generate signed action request
- `fetchNonceFromAPI(tradeAccountId, ownerId, api)` — Fetch nonce from O2 API
- `setSession(session)` / `setNonce(nonce)` — Manual state management

### `O2ApiClient`
Standalone REST client with 429 retry logic. Methods:
- `createTradingAccount(request, ownerIdB256)`
- `getAccount(tradeAccountId, ownerIdB256)`
- `getAccountByOwner(ownerAddress)`
- `createSession(request, ownerIdB256)`
- `sessionSubmitTransaction(request, ownerIdB256)`

### Adapters
- `createFuelNodeAccount(privateKey, providerUrl)` — Node.js Fuel wallet
- `createFuelBrowserAccount(fuel, providerUrl)` — Browser Fuel wallet
- `createEvmNodeAccount(evmPrivateKey, providerUrl)` — Node.js EVM wallet
- `createEvmBrowserAccount(evmAddress, providerUrl, wagmiConfig)` — Browser EVM wallet

### Encoders
- `encodeActions(identity, orderBook, config, actions, gasLimit)` — Encode trading actions
- `createCallContractArg(invocationScope, gasLimit)` — Encode a contract call arg
- `createCallToSign(nonce, chainId, invocationScope)` — Create bytes for session signing

## Session Lifecycle

```
1. CREATE    → createO2Session()   → session + signer + manager + API
2. TRADE     → encodeActions()     → api_SessionCallContractsParams() → sessionSubmitTransaction()
3. RESTORE   → restoreO2Session()  → manager + API (ready to trade)
4. EXPIRE    → after 30 days       → createO2Session() again
```

## Network Configuration

| Network | API URL | Fuel RPC |
|---------|---------|----------|
| Testnet | `https://api.testnet.o2.app/v1` | `https://testnet.fuel.network/v1/graphql` |
| Mainnet | `https://api.o2.app/v1` | `https://mainnet.fuel.network/v1/graphql` |

## Contract IDs

See `config.ts` for full listings. Key contracts:
- **Trade Account Registry** — deploys user trading accounts
- **Trade Account Oracle** — oracle for trade account operations
- **Order Book Registry** — manages order book contracts

## Asset IDs

See `config.ts` for full listings. Available assets: FUEL, USDC, ETH, USDT, MOOR, wBTC.

## Troubleshooting

**Session creation fails with "invalid expiry"**
- Ensure expiry is a Unix timestamp in seconds (not milliseconds)
- Must be at least 1 hour in the future

**Nonce mismatch errors**
- Call `fetchNonceFromAPI()` before creating sessions or submitting actions
- The nonce auto-increments after each successful action — call `incrementNonce()` after submission

**EVM signature rejected**
- EVM signatures must be converted from 65-byte (r+s+v) to 64-byte compact (r+yParityAndS) format
- The EVM adapters handle this automatically

**Address padding for EVM**
- EVM addresses (20 bytes) must be padded to 32 bytes for Fuel
- Use `computeOwnerIdB256(address, true)` for EVM addresses
