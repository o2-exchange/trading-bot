import { Wallet, Provider } from 'fuels';
import type { Account } from 'fuels';

/**
 * Create a Fuel Account from a private key (Node.js environment).
 *
 * The returned `Account` already implements `signMessage()` via the Fuel SDK
 * `Wallet` class, so it works directly with `TradeAccountManager`.
 */
export function createFuelNodeAccount(
  privateKey: string,
  providerUrl: string
): Account {
  const provider = new Provider(providerUrl);
  return Wallet.fromPrivateKey(privateKey, provider);
}
