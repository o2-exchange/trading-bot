import { Provider } from 'fuels';
import type { Account, Fuel } from 'fuels';

/**
 * Create a Fuel Account from a browser wallet extension.
 *
 * The caller is responsible for setting up Fuel connectors (FuelWallet, Fuelet,
 * etc.) and providing the connected `Fuel` instance.
 *
 * @param fuel - Connected Fuel instance with active connector
 * @param providerUrl - Fuel RPC URL
 */
export async function createFuelBrowserAccount(
  fuel: Fuel,
  providerUrl: string
): Promise<Account> {
  const provider = new Provider(providerUrl);
  const currentAccount = await fuel.currentAccount();
  if (!currentAccount) {
    throw new Error('No Fuel account connected. Ensure a wallet connector is active.');
  }
  const wallet = await fuel.getWallet(currentAccount, provider);
  return wallet;
}
