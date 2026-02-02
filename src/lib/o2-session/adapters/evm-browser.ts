import { Account, Address, Provider, HashableMessage, concat } from 'fuels';
import { parseSignature, signatureToCompactSignature, pad } from 'viem';
import type { ByteArray, SignableMessage } from 'viem';

/**
 * EVM Account adapter for browser environments.
 *
 * Uses wagmi's `signMessage` action to sign via MetaMask / WalletConnect,
 * converts the 65-byte EVM signature to 64-byte compact format for FuelVM,
 * and pads the 20-byte EVM address to a 32-byte Fuel address.
 *
 * The `wagmiConfig` is passed as a parameter — no global singleton.
 */
class EvmBrowserAccountAdapter extends Account {
  private wagmiConfig: any;

  constructor(address: Address, provider: Provider, wagmiConfig: any) {
    super(address, provider);
    this.wagmiConfig = wagmiConfig;
  }

  async signMessage(message: HashableMessage): Promise<string> {
    // Dynamic import to avoid bundling wagmi in Node.js paths
    const { signMessage: wagmiSignMessage } = await import('wagmi/actions');

    const getMessage = (): SignableMessage => {
      if (typeof message === 'string') {
        return message;
      }
      return {
        raw: message.personalSign as `0x${string}` | ByteArray,
      };
    };

    // Sign using EVM wallet (returns 65-byte signature: r + s + v)
    const signature = await (wagmiSignMessage as any)(this.wagmiConfig, {
      message: getMessage(),
    }) as `0x${string}`;

    // Convert to 64-byte compact format for FuelVM
    const compactSignature = signatureToCompactSignature(
      parseSignature(signature)
    );

    const signatureBytes = concat([compactSignature.r, compactSignature.yParityAndS]);
    return `0x${Array.from(signatureBytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  }
}

/**
 * Create a Fuel-compatible Account from an EVM browser wallet.
 *
 * Pads the 20-byte EVM address to a 32-byte Fuel address and wraps wagmi
 * signing to produce FuelVM-compatible compact signatures.
 *
 * @param evmAddress - The EVM address (0x-prefixed, 20 bytes)
 * @param providerUrl - Fuel RPC URL
 * @param wagmiConfig - wagmi Config instance (caller creates this)
 */
export function createEvmBrowserAccount(
  evmAddress: string,
  providerUrl: string,
  wagmiConfig: any
): Account {
  const provider = new Provider(providerUrl);

  // Pad 20-byte EVM address to 32-byte Fuel address
  const paddedAddress = pad(evmAddress as `0x${string}`, { size: 32 });
  const fuelAddress = Address.fromString(paddedAddress);

  return new EvmBrowserAccountAdapter(fuelAddress, provider, wagmiConfig);
}
