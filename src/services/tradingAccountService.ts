import { Address, BYTES_32 } from 'fuels'
import { pad } from 'viem'
import { o2ApiService } from './o2ApiService'
import { walletService } from './walletService'
import { TradingAccount } from '../types/tradingAccount'
import { db } from './dbService'
import { useTradingAccountAddressesStore } from '../stores/useTradingAccountAddressesStore'

/**
 * Trading Account Service with request deduplication
 * Prevents rate limiting (429) by ensuring only ONE API call per address
 */
class TradingAccountService {
  // Track in-flight requests to prevent duplicate API calls
  private pendingRequests = new Map<string, Promise<TradingAccount>>()

  async getOrCreateTradingAccount(ownerAddress: string): Promise<TradingAccount> {
    // Validate and normalize address
    if (!ownerAddress || typeof ownerAddress !== 'string') {
      throw new Error('Invalid owner address: address must be a non-empty string')
    }

    // Normalize address to lowercase for consistent storage
    const normalizedAddress = ownerAddress.toLowerCase()

    // CRITICAL: Check if there's already a pending request for this address
    // This prevents duplicate API calls that cause 429 rate limiting
    const pendingRequest = this.pendingRequests.get(normalizedAddress)
    if (pendingRequest) {
      console.log('[TradingAccountService] Reusing pending request for:', normalizedAddress)
      return pendingRequest
    }

    // Check cache first - if exists and stored, trust it (no verification needed)
    const addressesStore = useTradingAccountAddressesStore.getState()
    const cachedAccountId = addressesStore.getContract(normalizedAddress)
    if (cachedAccountId) {
      const stored = await db.tradingAccounts.get(cachedAccountId)
      if (stored) {
        console.log('[TradingAccountService] Using cached trading account:', stored.id)
        return stored // Trust cached account - no verification needed
      }
      // Cache invalid, clear it
      addressesStore.setContract(normalizedAddress, null as any)
    }

    // Check stored in database
    const stored = await db.tradingAccounts.where('ownerAddress').equals(normalizedAddress).first()
    if (stored) {
      // Update cache and return - trust stored data
      console.log('[TradingAccountService] Using stored trading account:', stored.id)
      addressesStore.setContract(normalizedAddress, stored.id)
      return stored
    }

    // No cached/stored account - create via API (idempotent - returns existing or creates)
    // Track this request to prevent duplicates
    console.log('[TradingAccountService] Fetching/creating trading account for:', normalizedAddress)
    const requestPromise = this.createTradingAccountViaApi(normalizedAddress)

    // Store the promise so concurrent calls can reuse it
    this.pendingRequests.set(normalizedAddress, requestPromise)

    try {
      const tradingAccount = await requestPromise
      return tradingAccount
    } finally {
      // Clean up the pending request when done
      this.pendingRequests.delete(normalizedAddress)
    }
  }

  private async createTradingAccountViaApi(normalizedAddress: string): Promise<TradingAccount> {
    const wallet = walletService.getConnectedWallet()
    const isEthereum = wallet && !wallet.isFuel

    // Prepare address: pad Ethereum addresses to 32 bytes (BYTES_32)
    let addressForApi: string
    if (isEthereum) {
      // Ethereum addresses need to be padded to 32 bytes before converting to B256
      addressForApi = pad(normalizedAddress as `0x${string}`, { size: BYTES_32 })
    } else {
      // Fuel addresses are already 32 bytes
      addressForApi = normalizedAddress
    }

    // Convert to B256 format
    const fuelAddress = Address.fromString(addressForApi)
    const b256Address = fuelAddress.toB256()

    // Call idempotent API (returns existing account or creates new one)
    const response = await o2ApiService.createTradingAccount(
      {
        identity: {
          Address: b256Address,
        },
      },
      normalizedAddress
    )

    // Store and cache
    const tradingAccount: TradingAccount = {
      id: response.trade_account_id,
      ownerAddress: normalizedAddress,
      createdAt: Date.now(),
      nonce: 0, // Will be fetched when needed via getAccount
    }

    await db.tradingAccounts.put(tradingAccount)
    useTradingAccountAddressesStore.getState().setContract(normalizedAddress, tradingAccount.id)

    console.log('[TradingAccountService] Trading account created/fetched:', tradingAccount.id)
    return tradingAccount
  }

  async getTradingAccount(ownerAddress: string): Promise<TradingAccount | null> {
    // Validate and normalize address
    if (!ownerAddress || typeof ownerAddress !== 'string') {
      return null
    }
    
    const normalizedAddress = ownerAddress.toLowerCase()
    const stored = await db.tradingAccounts.where('ownerAddress').equals(normalizedAddress).first()
    if (!stored) {
      return null
    }

    // Return stored account - trust it (no verification needed)
    return stored
  }

  async updateNonce(accountId: string, nonce: number): Promise<void> {
    await db.tradingAccounts.update(accountId, { nonce })
  }
}

export const tradingAccountService = new TradingAccountService()

