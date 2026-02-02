# Add Deposit Asset: $ARGUMENTS

Add deposit support for a new asset (`$ARGUMENTS`) in the O2 trading bot.

## Steps

1. **Read the deposit constants** for the exact structure:
   - `src/constants/depositConstants.ts` -- `DEFAULT_DEPOSIT_ASSETS` array, existing USDC/ETH/WBTC entries
   - `src/types/deposit.ts` -- `DepositAsset` interface

2. **Add entry to `DEFAULT_DEPOSIT_ASSETS`** in `src/constants/depositConstants.ts`:
   ```typescript
   {
     symbol: '$ARGUMENTS',
     name: 'Full Asset Name',
     universalId: '0x...', // Universal asset identifier
     fuel: {
       assetId: '0x...', // Fuel canonical address
       decimals: 9,       // Asset decimals on Fuel
     },
     evm: {
       [base.id]: {
         address: '0x...', // Base chain contract address
         decimals: 6,       // Decimals on Base
       },
       [mainnet.id]: {
         address: '0x...', // Ethereum mainnet contract address
         decimals: 6,       // Decimals on Ethereum
       },
     },
     precision: {
       min: 6,  // Minimum display precision
       max: 9,  // Maximum display precision
     },
     supportsPermit: true, // Whether ERC-2612 permit is supported
   }
   ```

3. **Gather required addresses**:
   - Fuel canonical asset ID (from O2 or Fuel explorer)
   - EVM contract addresses per chain (Base, Ethereum mainnet)
   - Decimal precision for each chain
   - Universal asset ID

4. **Update deposit UI** if the asset needs special handling:
   - `src/components/DepositDialog/index.tsx`
   - `src/services/deposit/depositAssetService.ts`

5. **Add i18n keys** if asset-specific labels are needed.

## Reference: Existing Assets

Check `depositConstants.ts` for USDC, ETH, and WBTC entries as examples of the exact format.

## Key Details

- `supportsPermit`: Set to `true` if the ERC-20 supports ERC-2612 permit (gasless approvals). ETH native does not.
- `precision.min` / `precision.max`: Controls display formatting in the UI
- EVM addresses: Must include entries for each supported chain (Base and Ethereum mainnet)
- Special handling: Native ETH uses `NATIVE_ETH` constant (`0xEeee...`) instead of a contract address

## Checklist

- [ ] `DepositAsset` entry added to `DEFAULT_DEPOSIT_ASSETS`
- [ ] Fuel asset ID is correct and verified
- [ ] EVM contract addresses correct for all chains (Base, Ethereum)
- [ ] Decimals correct for each chain
- [ ] `supportsPermit` flag set correctly
- [ ] Precision bounds set appropriately
- [ ] UI renders the new asset in deposit dialog
- [ ] Asset name and symbol match O2 exchange listing
