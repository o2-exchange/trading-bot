import { Fuel, FuelConfig } from 'fuels'
import {
  FuelWalletConnector,
  FueletWalletConnector,
  BakoSafeConnector,
} from '@fuels/connectors'
import { createConfig, createConnector, http } from 'wagmi'
import { walletConnect, injected } from 'wagmi/connectors'
import { connect, getAccount, disconnect as wagmiDisconnect } from 'wagmi/actions'
import { sepolia, base, baseSepolia, mainnet } from 'wagmi/chains'
import { ConnectedWallet, WalletType } from '../types/wallet'
import { useWalletStore } from '../stores/useWalletStore'

// Initialize Fuel connectors
const fuelWalletConnector = new FuelWalletConnector()
const fueletWalletConnector = new FueletWalletConnector()
const bakoSafeConnector = new BakoSafeConnector()

const fuelConfig: FuelConfig = {
  connectors: [fuelWalletConnector, fueletWalletConnector, bakoSafeConnector as any],
}

export const fuel = new Fuel(fuelConfig)

// Initialize Wagmi config for Ethereum wallets
// Note: You'll need to set WALLETCONNECT_PROJECT_ID in environment
const WALLETCONNECT_PROJECT_ID = ((import.meta as any).env?.VITE_WALLETCONNECT_PROJECT_ID as string) || ''

export const wagmiConfig = createConfig({
  chains: [baseSepolia, sepolia, base, mainnet],
  transports: {
    [sepolia.id]: http(),
    [baseSepolia.id]: http(),
    [base.id]: http(),
    [mainnet.id]: http(),
  },
  connectors: [
    injected(),
    ...(WALLETCONNECT_PROJECT_ID
      ? [
          walletConnect({
            projectId: WALLETCONNECT_PROJECT_ID,
          }) as ReturnType<typeof createConnector>,
        ]
      : []),
  ],
})

class WalletService {
  async connectFuelWallet(walletType: 'fuel' | 'fuelet' | 'bako-safe'): Promise<ConnectedWallet> {
    let connector
    switch (walletType) {
      case 'fuel':
        connector = fuelWalletConnector
        break
      case 'fuelet':
        connector = fueletWalletConnector
        break
      case 'bako-safe':
        connector = bakoSafeConnector
        break
      default:
        throw new Error(`Unknown Fuel wallet type: ${walletType}`)
    }

    console.log('[WalletService] Connecting to Fuel wallet:', walletType)
    console.log('[WalletService] Connector name:', connector.name)

    // Check if the connector is installed/available
    try {
      const isInstalled = await connector.ping()
      if (!isInstalled) {
        throw new Error(`${connector.name} is not installed or not available`)
      }
      console.log('[WalletService] Connector is installed')
    } catch (error) {
      throw new Error(`${connector.name} is not installed. Please install the wallet extension first.`)
    }

    // Check if there's already a connection
    const hasConnector = await fuel.hasConnector()
    console.log('[WalletService] Has connector:', hasConnector)

    // Select the connector
    console.log('[WalletService] Selecting connector:', connector.name)
    await fuel.selectConnector(connector.name)

    // Connect to the wallet
    console.log('[WalletService] Calling fuel.connect()...')
    await fuel.connect()
    console.log('[WalletService] fuel.connect() completed')

    // Get the account
    const account = await fuel.currentAccount()
    console.log('[WalletService] Current account:', account ? 'Found' : 'Not found')

    if (!account) {
      throw new Error('Failed to get account from Fuel wallet')
    }

    // Convert Address object to string (B256 format)
    const addressString = (account as any).address?.toB256?.() || (account as any).address || String(account)
    console.log('[WalletService] Account address:', addressString)

    // CRITICAL: DO NOT set wallet in store here!
    // Let WalletConnectionWatcher handle it via Fuel SDK events
    // This prevents race conditions and duplicate handling
    const wallet: ConnectedWallet = {
      type: walletType,
      address: addressString,
      isFuel: true,
      connector,
    }

    console.log('[WalletService] Wallet connected successfully - waiting for event handler')
    return wallet
  }

  async connectEthereumWallet(connectorName?: string): Promise<ConnectedWallet> {
    try {
      // Get available connectors
      const connectors = wagmiConfig.connectors
      
      // Find the connector by name, or use injected (MetaMask) by default
      let connector = connectors.find((c) => c.name === connectorName)
      if (!connector && connectorName) {
        throw new Error(`Connector ${connectorName} not found`)
      }
      if (!connector) {
        // Default to injected (MetaMask)
        connector = connectors.find((c) => c.name === 'injected' || c.id === 'injected')
        if (!connector) {
          throw new Error('No Ethereum wallet connector available')
        }
      }

      // Connect using wagmi
      const result = await connect(wagmiConfig, {
        connector,
      })

      if (!result.accounts.length) {
        throw new Error('No account found after connection')
      }

      const address = result.accounts[0] as string

      const wallet: ConnectedWallet = {
        type: connector.name as WalletType,
        address,
        isFuel: false,
        connector,
      }

      // Persist to store
      useWalletStore.getState().setConnectedWallet(wallet)
      return wallet
    } catch (error: any) {
      throw new Error(`Failed to connect Ethereum wallet: ${error.message}`)
    }
  }

  async getEthereumAccount(): Promise<string | null> {
    try {
      const account = await getAccount(wagmiConfig)
      return account.address || null
    } catch {
      return null
    }
  }

  async disconnect(): Promise<void> {
    const wallet = useWalletStore.getState().connectedWallet
    if (wallet?.isFuel) {
      await fuel.disconnect()
    } else {
      // Disconnect Ethereum wallet
      try {
        await wagmiDisconnect(wagmiConfig)
      } catch (error) {
        console.warn('Error disconnecting Ethereum wallet', error)
      }
    }
    // Clear from store
    useWalletStore.getState().clearWallet()
  }

  getConnectedWallet(): ConnectedWallet | null {
    return useWalletStore.getState().connectedWallet
  }

  async restoreConnection(): Promise<ConnectedWallet | null> {
    const stored = useWalletStore.getState().connectedWallet
    if (!stored) {
      return null
    }

    try {
      if (stored.isFuel) {
        // Try to restore Fuel connection
        const account = await fuel.currentAccount()
        if (account && typeof account !== 'string' && (account as any).address) {
          const address = (account as any).address.toB256()
          if (address === stored.address) {
            return stored
          }
        }
      } else {
        // Try to restore Ethereum connection
        const account = await getAccount(wagmiConfig)
        if (account && account.address && account.address.toLowerCase() === stored.address.toLowerCase()) {
          return stored
        }
      }
    } catch (error) {
      console.warn('Failed to restore connection', error)
      // Clear invalid connection
      useWalletStore.getState().clearWallet()
    }

    return null
  }

  async getCurrentAccount(): Promise<string | null> {
    const wallet = this.getConnectedWallet()
    if (wallet?.isFuel) {
      const account = await fuel.currentAccount()
      if (account && typeof account !== 'string' && (account as any).address) {
        return (account as any).address.toB256() || null
      }
      return null
    }
    return wallet?.address || null
  }

  async signMessage(message: string): Promise<string> {
    const wallet = this.getConnectedWallet()
    if (!wallet) {
      throw new Error('No wallet connected')
    }

    if (wallet.isFuel) {
      const account = await fuel.currentAccount()
      if (!account || typeof account === 'string') {
        throw new Error('No Fuel account available')
      }
      // Sign message with Fuel wallet
      const signature = await (account as any).signMessage(message)
      return signature
    }

    // Ethereum wallet signing
    // Note: For Ethereum wallets, we need to use the provider's signMessage
    // This is a simplified version - in production, use wagmi's useSignMessage hook
    throw new Error('Ethereum wallet message signing requires provider integration')
  }

  getAvailableEthereumConnectors() {
    return wagmiConfig.connectors.map((connector) => ({
      id: connector.id,
      name: connector.name,
      type: 'ethereum' as const,
    }))
  }
}

export const walletService = new WalletService()

