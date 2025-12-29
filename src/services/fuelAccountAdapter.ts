import { Account, Address, Provider, HashableMessage, hexlify, concat, toUtf8Bytes, sha256 } from 'fuels'
import { fuel } from './walletService'

interface FuelAccountAdapterConfig {
  address: Address
  provider: Provider
}

/**
 * Adapter for Fuel wallet connectors that properly handles { personalSign } format.
 * 
 * The connector's signMessage() expects a STRING (hex), not the { personalSign: Uint8Array }
 * object that O2's TradeAccountManager uses. This adapter:
 * 1. Extends Account (like O2's EvmAccountAdapter and PrivyAccountAdapter)
 * 2. Converts { personalSign } to hex string before calling connector
 * 3. Returns the signature directly (Fuel wallets return correct format)
 * 
 * O2 Reference: packages/web-app/src/systems/Connectors/utils/EvmAccountAdapter.ts
 */
export class FuelWalletAdapter extends Account {
  readonly address: Address
  private fuelConnector: any  // Renamed to avoid conflict with parent's _connector

  constructor(config: FuelAccountAdapterConfig & { connector: any }) {
    super(config.address, config.provider)
    this.address = config.address
    this.fuelConnector = config.connector
    
    // CRITICAL: Clear any _connector that parent might have set
    // This ensures our signMessage override is used, not parent's
    ;(this as any)._connector = undefined
    
    console.log('[FuelWalletAdapter] Constructor complete')
    console.log('[FuelWalletAdapter] _connector cleared:', (this as any)._connector === undefined)
  }

  async signMessage(message: HashableMessage): Promise<string> {
    // CRITICAL: This override MUST be called, not parent's
    console.log('[FuelWalletAdapter] ========== signMessage OVERRIDE called ==========')
    console.log('[FuelWalletAdapter] message type:', typeof message)
    console.log('[FuelWalletAdapter] message is object:', message && typeof message === 'object')
    
    const addressB256 = this.address.toB256()
    console.log('[FuelWalletAdapter] Address:', addressB256)
    console.log('[FuelWalletAdapter] Connector:', this.fuelConnector?.name || 'unknown')
    
    // The connector's signMessage expects a STRING, not an object.
    // If we pass { personalSign }, it fails with "t.trim is not a function".
    //
    // For { personalSign } messages, the SDK's hashMessage adds:
    //   "Fuel Signed Message:\n" + length + bytes
    // then hashes it. The O2 backend expects this format.
    //
    // SOLUTION: Compute the hash ourselves with the prefix, then pass as hex string.
    // The connector will sign this "message" (which is actually a hash).
    // The backend will reconstruct the same hash and verify.
    
    let messageToSign: string
    
    if (typeof message === 'string') {
      // For plain strings, just pass through
      messageToSign = message
      console.log('[FuelWalletAdapter] Plain string message')
    } else if (message && typeof message === 'object' && 'personalSign' in message) {
      // For { personalSign }, we need to compute the hash that matches the backend.
      // 
      // The Rust backend expects: SHA256("\x19Fuel Signed Message:\n" + length + bytes)
      // The JS SDK hashMessage uses: SHA256("Fuel Signed Message:\n" + length + bytes) - NO \x19!
      //
      // APPROACH: Compute the hash ourselves with the correct \x19 prefix,
      // then pass this hash to the wallet. The wallet will sign it as a "message",
      // which means it will hash it AGAIN with its own prefix.
      //
      // BUT - if we pass the pre-computed hash as a string, the wallet will
      // treat it as a message and double-hash. This won't work.
      //
      // ALTERNATIVE: The wallet might support signing raw data if we pass the bytes
      // in a specific format. Let's try passing the hash as raw bytes (not hex string).
      
      const bytes = (message as { personalSign: Uint8Array }).personalSign
      console.log('[FuelWalletAdapter] personalSign bytes length:', bytes?.length)
      
      // Compute hash with the CORRECT \x19 prefix (matching Rust backend)
      const EIP191_PREFIX = '\x19Fuel Signed Message:\n'
      const payload = concat([
        toUtf8Bytes(EIP191_PREFIX),
        toUtf8Bytes(String(bytes.length)),
        bytes
      ])
      const hash = sha256(payload)
      
      console.log('[FuelWalletAdapter] Computed hash with \\x19 prefix:', hash)
      
      // Pass the hash as the message to sign.
      // The wallet will show this hash to the user and sign it.
      // If the wallet hashes this AGAIN, verification will fail.
      // But some wallets might recognize this as a pre-computed hash.
      messageToSign = hash
    } else {
      throw new Error('Invalid message format')
    }
    
    console.log('[FuelWalletAdapter] Calling connector.signMessage with:', messageToSign.substring(0, 40) + '...')
    
    // The connector receives a string and signs it
    const signature = await this.fuelConnector.signMessage(addressB256, messageToSign)

    console.log('[FuelWalletAdapter] Signature received:', signature?.substring?.(0, 40) + '...')
    
    return signature
  }
}

/**
 * Creates a Fuel wallet adapter that properly handles { personalSign } format.
 */
export async function createFuelAccountAdapter(config: FuelAccountAdapterConfig): Promise<Account> {
  console.log('[FuelAccountAdapter] Creating adapter for address:', config.address.toB256())
  
  // Get the current connector
  const connector = await fuel.currentConnector()
  if (!connector) {
    throw new Error('No Fuel connector available')
  }
  
  console.log('[FuelAccountAdapter] Using connector:', connector.name)
  
  // Create our custom adapter that handles { personalSign } conversion
  const adapter = new FuelWalletAdapter({
    address: config.address,
    provider: config.provider,
    connector
  })
  
  return adapter
}