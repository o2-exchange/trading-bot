import { Account, Address, Provider, HashableMessage, concat } from 'fuels';
import { Wallet as EthersWallet } from 'ethers';
import { parseSignature, signatureToCompactSignature } from 'viem';
import { pad } from 'viem';
import type { ByteArray, SignableMessage } from 'viem';

/**
 * EVM Account adapter for Node.js environments.
 *
 * Uses an ethers.js `Wallet` to sign messages, converts the 65-byte EVM
 * signature to 64-byte compact format for FuelVM, and pads the 20-byte
 * EVM address to a 32-byte Fuel address.
 */
class EvmNodeAccountAdapter extends Account {
  private evmWallet: EthersWallet;

  constructor(address: Address, provider: Provider, evmWallet: EthersWallet) {
    super(address, provider);
    this.evmWallet = evmWallet;
  }

  async signMessage(message: HashableMessage): Promise<string> {
    const getMessage = (): SignableMessage => {
      if (typeof message === 'string') {
        return message;
      }
      return {
        raw: message.personalSign as `0x${string}` | ByteArray,
      };
    };

    const msg = getMessage();
    let rawBytes: Uint8Array;
    if (typeof msg === 'string') {
      rawBytes = new TextEncoder().encode(msg);
    } else {
      const raw = (msg as { raw: `0x${string}` | ByteArray }).raw;
      if (typeof raw === 'string') {
        // hex string
        rawBytes = Uint8Array.from(
          raw.slice(2).match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
        );
      } else {
        rawBytes = new Uint8Array(raw);
      }
    }

    // Sign with ethers (returns 65-byte signature: r + s + v)
    const signature = await this.evmWallet.signMessage(rawBytes);

    // Convert to 64-byte compact format for FuelVM
    const compactSignature = signatureToCompactSignature(
      parseSignature(signature as `0x${string}`)
    );

    const signatureBytes = concat([compactSignature.r, compactSignature.yParityAndS]);
    return `0x${Array.from(signatureBytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  }
}

/**
 * Create a Fuel-compatible Account from an EVM private key (Node.js).
 *
 * Pads the 20-byte EVM address to a 32-byte Fuel address and wraps ethers.js
 * signing to produce FuelVM-compatible compact signatures.
 */
export function createEvmNodeAccount(
  evmPrivateKey: string,
  providerUrl: string
): Account {
  const provider = new Provider(providerUrl);
  const evmWallet = new EthersWallet(evmPrivateKey);

  // Pad 20-byte EVM address to 32-byte Fuel address
  const paddedAddress = pad(evmWallet.address as `0x${string}`, { size: 32 });
  const fuelAddress = Address.fromString(paddedAddress);

  return new EvmNodeAccountAdapter(fuelAddress, provider, evmWallet);
}
