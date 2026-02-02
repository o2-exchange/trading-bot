---
name: o2-auth-session-trading-flow
version: 1.0.0
description: End-to-end flow documentation for O2 trading bot — from wallet connection to order placement.
---

# O2 Auth, Session & Trading Flow

This document traces the complete flow through the codebase: app startup → wallet connection → account creation → session setup → order placement.

---

## Flow Overview

```
App Startup
  │
  ▼
Wallet Connection  (walletService.ts)
  │
  ▼
Auth Flow State Machine  (authFlowService.ts)
  │
  ├─ Check existing session  (sessionService.ts)
  ├─ Create/fetch trading account  (tradingAccountService.ts)
  ├─ Terms & whitelist endpoint  (eligibilityService.ts)
  └─ Session creation  (sessionService.ts, tradeAccountManager.ts)
      │
      ▼
  Trading  (orderService.ts, unifiedStrategyExecutor.ts, tradingEngine.ts)
```

---

## Step 1: App Startup

**Files:**
- `src/main.tsx` — React entry point
- `src/App.tsx` — Top-level component

On mount, the app:
1. Initializes providers (PostHog, Wagmi, Fuel).
2. Calls `walletService.restoreConnection()` to reconnect a previously connected wallet.
3. Renders `WalletConnectionWatcher`, which monitors wallet state changes and triggers the auth flow when a wallet connects or changes.
4. Renders `TradingEngineManager`, which orchestrates strategy execution once a session is active.

---

## Step 2: Wallet Connection

**File:** `src/services/walletService.ts`

Supports two wallet families:

| Family | Wallets | Connection Method |
|--------|---------|-------------------|
| **Fuel** | FuelWallet, Fuelet, Bako Safe | `fuel.selectConnector(name)` → `fuel.connect()` |
| **Ethereum** | MetaMask, WalletConnect | Wagmi connectors via `wagmiConfig` |

**Fuel connection:**
```
fuel.selectConnector(connectorName)
  → fuel.connect()
  → fuel.currentAccount()  // returns Fuel address
```

**Ethereum connection:**
```
wagmiConfig.connectors  // injected, walletConnect
  → wagmiSignMessage()   // used later for session signing
```

Returns a `ConnectedWallet { type, address, isFuel }` that the auth flow consumes.

---

## Step 3: Auth Flow (State Machine)

**File:** `src/services/authFlowService.ts` (~620 lines)

The auth flow is a state machine with these states:

```
idle
  → checkingSituation
    → checkingTerms
      → awaitingTerms
        → awaitingSignature
          → creatingSession
            → awaitingWelcome
              → ready
```

### 3a. Check Existing Session

Before doing anything expensive, the flow checks for a valid session:

```
sessionService.getActiveSession(ownerAddress)
  → Found and not expired? → Skip to "ready"
  → Not found or expired? → Continue to next step
```

**File:** `src/services/sessionService.ts` (session lookup and validation logic)

### 3b. Check Situation

Creates or fetches the trading account and fetches available markets.

```
tradingAccountService.getOrCreateTradingAccount(ownerAddress)
marketService.fetchMarkets()
```

### 3c. Terms & Whitelist

O2 is now **public** — there is no invitation or access-gating flow. However, a single whitelist API endpoint still needs to be called during onboarding to register the trading account. This is a lightweight call, not an approval gate.

1. Show terms dialog (state: `awaitingTerms`).
2. On acceptance, call the whitelist endpoint to register the account.

**File:** `src/services/eligibilityService.ts` — `whitelistTradingAccount()` (single endpoint call)

### 3d. Await Signature

The flow enters `awaitingSignature` state. The UI shows a confirmation dialog. When the user confirms, `confirmSignature()` is called, which triggers session creation.

---

## Step 4: Trading Account Creation

**File:** `src/services/tradingAccountService.ts` (~138 lines)

```
getOrCreateTradingAccount(ownerAddress)
  │
  ├─ 1. Check in-memory pending requests (deduplicates concurrent calls)
  ├─ 2. Check IndexedDB cache (db.tradingAccounts)
  ├─ 3. Call O2 API: o2ApiService.createTradingAccount({ identity: { Address: b256Address } })
  └─ 4. Store result in IndexedDB and return
```

**API call:** `POST /v1/accounts` with `{ identity: { Address: "0x..." } }`

**Response:** `{ trade_account_id: "0x...", nonce: "0" }`

The call is **idempotent** — calling multiple times returns the same account. Concurrent requests share a single promise to avoid duplicate API calls.

**File:** `src/services/o2ApiService.ts` — `createTradingAccount()` method

---

## Step 5: Session Creation

**File:** `src/services/sessionService.ts` (~542 lines)
**File:** `src/services/tradeAccountManager.ts` (~262 lines)
**File:** `src/services/fuelSessionSigner.ts` (~28 lines)

### 5a. Generate Session Signer

A temporary keypair is generated for the session. This signer handles all subsequent contract calls so the user doesn't need to sign every transaction.

```typescript
const sessionWallet = Wallet.generate({ provider })
const sessionSigner = new FuelSessionSigner(sessionWallet.privateKey)
```

The `FuelSessionSigner` hashes data with SHA256 and signs with Secp256k1:

```typescript
async sign(data: Uint8Array): Promise<SignatureInput> {
  const signature = this.signer.sign(sha256(data))
  return { Secp256k1: { bits: Array.from(arrayify(signature)) } }
}
```

### 5b. Create TradeAccountManager

```typescript
const tradeAccountManager = new TradeAccountManager({
  account: ownerAccount,           // owner's main wallet
  signer: sessionSigner,           // temporary session signer
  tradeAccountId: tradeAccountId,  // trading account contract ID
  defaultGasLimit: GAS_LIMIT_DEFAULT
})
```

### 5c. Fetch Nonce

```
tradeAccountManager.fetchNonce()
  → Calls get_nonce() on the TradeAccount contract
  → Prevents replay attacks
```

### 5d. Create Session (Sponsored Flow)

The user signs a **message** (not a transaction). The O2 API creates the session on-chain and covers the gas cost. This works with all supported wallets (FuelWallet, MetaMask, WalletConnect).

```
tradeAccountManager.api_CreateSessionParams(contractIds, expiryInSeconds)
  → User signs a message with their wallet
  → Returns session params including signature

o2ApiService.createSession(sessionParams, ownerIdForHeader)
  → PUT /v1/session
  → API creates session on-chain (user pays nothing)
```

### 5e. Persist Session

After creation, the session is stored in three places:

1. **IndexedDB `db.sessionKeys`** — encrypted private key (salt + iv + ciphertext)
2. **IndexedDB `db.sessions`** — metadata (tradeAccountId, ownerAddress, contractIds, expiry, isActive)
3. **Zustand store** — in-memory session state for the UI

**File:** `src/services/dbService.ts` — IndexedDB schema and operations

**Default session duration:** 30 days (`now + 30 * 24 * 60 * 60` seconds)

---

## Step 6: Session Recovery (On Restart)

**File:** `src/services/sessionManagerService.ts` (~150 lines)

When the bot restarts and needs to trade, it recovers the session from storage:

```
sessionManagerService.getTradeAccountManager(ownerAddress, refreshNonce)
  │
  ├─ 1. Get active session from DB (sessionService.getActiveSession)
  ├─ 2. Check manager cache (keyed by address + sessionId)
  │     └─ Cache hit? Return cached manager (optionally refresh nonce)
  ├─ 3. Decrypt session key from IndexedDB
  │     └─ sessionService.getSessionKey(sessionId) → FuelSessionSigner
  ├─ 4. Create TradeAccountManager with recovered signer
  ├─ 5. Fetch latest nonce from API (fetchNonceFromAPI)
  ├─ 6. Recover session from chain (fallback: use stored session)
  └─ 7. Cache manager for future use
```

### Session Validation

**File:** `src/services/sessionService.ts` (validation logic, ~lines 315-452)

```
validateSession(tradingAccountId, ownerAddress)
  │
  ├─ 1. Check local expiry (quick, no network call)
  │     └─ Expired? Clear session, return false
  ├─ 2. Check on-chain validity (30-second TTL cache)
  │     └─ manager.validateSession()
  │     └─ Revoked? Clear session, return false
  └─ 3. Return true
```

The 30-second cache prevents excessive blockchain calls during rapid trading.

---

## Step 7: Placing Orders

**File:** `src/services/orderService.ts` (~387 lines)
**File:** `src/utils/o2/o2Encoders.ts` (~300 lines)

### Order Placement Flow

```
orderService.placeOrder(market, side, orderType, price, quantity, ownerAddress)
  │
  ├─ 1. Get active session
  │     └─ sessionService.getActiveSession(ownerAddress)
  │
  ├─ 2. Get TradeAccountManager with fresh nonce
  │     └─ sessionManagerService.getTradeAccountManager(ownerAddress, refreshNonce=true)
  │
  ├─ 3. Create order action
  │     └─ { CreateOrder: { side, order_type, price, quantity } }
  │
  ├─ 4. Encode actions (o2Encoders.ts)
  │     └─ Wraps order in SettleBalance sandwich:
  │        SettleBalance → CreateOrder → SettleBalance
  │
  ├─ 5. Sign with session signer
  │     └─ tradeAccountManager.api_SessionCallContractsParams(encodedActions)
  │
  ├─ 6. Submit to O2 API
  │     └─ o2ApiService.sessionSubmitTransaction(payload, ownerAddress)
  │     └─ POST /v1/session/actions
  │
  ├─ 7. Increment nonce in memory
  │     └─ tradeAccountManager.incrementNonce()
  │
  ├─ 8. Persist nonce to DB (3x retry, fallback to on-chain nonce)
  │     └─ tradingAccountService.updateNonce(tradeAccountId, newNonce)
  │
  ├─ 9. Clear balance cache
  │     └─ balanceService.clearCache()
  │
  └─ 10. Store order in DB and return
        └─ db.orders.put(order)
```

### SettleBalance Sandwich

Every `CreateOrder` is wrapped with `SettleBalance` calls:

```
encodeActions(identity, orderBook, config, actions, gasLimit)
  → SettleBalance  (settle unlocked funds from previous orders)
  → CreateOrder    (the actual order)
  → SettleBalance  (settle any immediate fills)
```

This ensures funds are available before placement and settled after execution.

### Signing Flow for Session Calls

```
1. Encode contract calls → raw bytes
2. Concat all call bytes
3. Session signer prepends nonce + call count, then signs (SHA256 + Secp256k1)
4. Submit signed payload to API
5. Increment nonce for next call
```

---

## Step 8: Ethereum Wallet Compatibility

**File:** `src/services/ethereumAccountAdapter.ts` (~48 lines)

EVM wallets produce 65-byte signatures (r + s + v). Fuel expects 64-byte compact signatures (r + s). The adapter handles conversion:

```
EthereumAccountAdapter.signMessage(message)
  → wagmiSignMessage(message)           // 65-byte EVM signature
  → signatureToCompactSignature()       // strip v byte → 64-byte compact
  → return as hex string
```

Ethereum addresses (20 bytes) are padded to 32 bytes with `viem.pad()` for Fuel compatibility.

---

## Step 9: Strategy Execution

**File:** `src/services/tradingEngine.ts` — Main trading loop
**File:** `src/services/unifiedStrategyExecutor.ts` — Strategy logic (market making, stop loss, etc.)

The `TradingEngineManager` component runs repeated trading cycles:

```
tradingEngine cycle:
  → Check market conditions (prices, spreads, balances)
  → Execute strategy (e.g., place grid orders, check stop loss)
  → Each strategy action calls orderService.placeOrder() or orderService.cancelOrder()
  → Wait for next cycle interval
```

---

## File Reference

| File | Purpose |
|------|---------|
| `src/App.tsx` | Top-level component, provider setup |
| `src/services/walletService.ts` | Wallet connection (Fuel & Ethereum) |
| `src/services/authFlowService.ts` | Auth flow state machine (~620 lines) |
| `src/services/tradingAccountService.ts` | Trading account create/fetch (~138 lines) |
| `src/services/sessionService.ts` | Session creation, validation, persistence (~542 lines) |
| `src/services/sessionManagerService.ts` | Session recovery & manager caching (~150 lines) |
| `src/services/tradeAccountManager.ts` | TradeAccountManager — nonce, signing, session params (~262 lines) |
| `src/services/fuelSessionSigner.ts` | Session signer (SHA256 + Secp256k1) (~28 lines) |
| `src/services/ethereumAccountAdapter.ts` | EVM → Fuel signature conversion (~48 lines) |
| `src/services/orderService.ts` | Order placement & cancellation (~387 lines) |
| `src/services/o2ApiService.ts` | REST API client for O2 DEX (~439 lines) |
| `src/services/eligibilityService.ts` | Whitelist endpoint call (single registration call, O2 is public) |
| `src/services/balanceService.ts` | Balance fetching & caching |
| `src/services/marketService.ts` | Market data & ticker info |
| `src/services/dbService.ts` | IndexedDB persistence (Dexie ORM) |
| `src/services/tradingEngine.ts` | Main trading loop |
| `src/services/unifiedStrategyExecutor.ts` | Strategy logic (market making, stop loss) |
| `src/utils/o2/o2Encoders.ts` | Contract call encoding (~300 lines) |

---

## Key Implementation Details

- **Nonce management:** Incremented after every transaction and persisted to IndexedDB with 3x retry. On failure, falls back to fetching the nonce from the chain.
- **Session duration:** 30 days by default. Validated against both local expiry and on-chain state (30-second cache).
- **Session encryption:** Private keys are encrypted before IndexedDB storage using AES with salt and IV.
- **Request deduplication:** `tradingAccountService` shares a single promise across concurrent `getOrCreateTradingAccount` calls.
- **Rate limiting:** O2 API 429 responses handled with exponential backoff (1s, 2s, 4s max).
- **Action limits:** Max 5 markets per session call, max 5 actions per market, 5-second execution timeout.
