import type { NetworkConfig, NetworkName } from './types';

// ─── Default constants ───────────────────────────────────────────────────────

/** 30 days in seconds */
export const DEFAULT_SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60;

/** Max u64 — default gas limit for session calls */
export const DEFAULT_GAS_LIMIT = '18446744073709551615';

/** Minimum gas limit sent in session action requests */
export const DEFAULT_MIN_GAS_LIMIT = '20000000';

// ─── Network configurations ─────────────────────────────────────────────────

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  testnet: {
    name: 'testnet',
    apiUrl: 'https://api.testnet.o2.app/v1',
    fuelRpcUrl: 'https://testnet.fuel.network/v1/graphql',
    contracts: {
      tradeAccountRegistry: '0xe348ec55ed90ab8e77253db67e364b85dce7d155b1fee8b251f0c3abea65466e',
      tradeAccountOracle: '0x8ece231c882a751c604f3fa78d405a71942c6441474603c5a86b0bb2e4ae26c6',
      orderBookRegistry: '0x92c32a4c11d570187d0045abd1c0e8900a305f8ce7b608b8f3ea332ab01d2f69',
      orderBookWhitelist: '0xdc80c26954c13e8949da76f011c6d9f90defaf01ba13250d5f2f2ee3a577c3ea',
      orderBookBlacklist: '0xabffb1d639cf2879ac460a3313e91bc56772c0494dc1ec1946a491316d863965',
    },
    assets: {
      FUEL: '0x43eebd58e837c2e8fa94f1b2db1268175c551b5b1bf41a59fafc4f2c69ab7dc2',
      USDC: '0x993a09322c3d856c5ae7e13c9c4eae52abebb78273aeefea374ab772cee72f68',
      ETH: '0xd2ccde1c40aa576196b1f868671d60dc59d604c2e463ac483686d14ccd4b38c8',
      USDT: '0x1b7c7d86ad13e3dbd6e829bfed8798532e1abfcdd4de6caf3a5e18e808a1cc59',
      MOOR: '0x80ccf78897bb7e73a8f87e91f0865d3bd6967edf3dcd531ee8cc6d9bc2d453c1',
      wBTC: '0x2a952909edc3d0e74602e6cb88bad8b3d50be00def897ae13f97bd46a1e7cee8',
    },
  },
  mainnet: {
    name: 'mainnet',
    apiUrl: 'https://api.o2.app/v1',
    fuelRpcUrl: 'https://mainnet.fuel.network/v1/graphql',
    contracts: {
      tradeAccountRegistry: '0x284c6802ad33bb95a37a1113106238ee9d084aa337879b62d2c3a8a74401cdb2',
      tradeAccountOracle: '0x8746b0b1e5056c9282522181234f370177816d5edd243bdd1a654c10597a1a79',
      orderBookRegistry: '0xcf500730294e90672baa0ec8cf0f04c28afea2411dfc28550212cd8a1381666f',
      orderBookWhitelist: '0x4ff40b704305bb5b44b016c51c6fe37429939320406d013d46cd3cca4247f872',
      orderBookBlacklist: '0x02c7b1edf72ac8135d21da3eb27205432ca09c88968a65eb6eb165b48e842368',
    },
    assets: {
      FUEL: '0x27821a5432b60fb3e70c64d0a612c2c86218c1088dd0f0f1b0dd6ae5ae17bd5b',
      USDC: '0x6c91bc65f585da1a238f8ec5e410e62616d2b2c8f2cb4701e225deb51240add6',
      ETH: '0xac2aabc1c48e634800a723b1372388ad1eb6a23d0e012cde4c603082fb1a140a',
      USDT: '0x2269aa41cf3982753d978a40e0f04618ff9d84b07d1ce10e99831e3217d3a9b0',
      MOOR: '0x851e17e6c88a20541279a873bb0d991ec09f78e4986196833366f4ccc4173dc7',
      wBTC: '0x1a48bde9b03ff7f6ab9d566c3f8968a532a782402976053cebfa113cbb9a03ef',
    },
  },
};
