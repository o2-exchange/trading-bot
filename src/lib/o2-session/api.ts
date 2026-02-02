import axios, { AxiosInstance } from 'axios';
import type {
  CreateTradingAccountRequest,
  CreateTradingAccountResponse,
  GetAccountResponse,
  API_CreateSessionRequest,
  API_SessionCallContractRequest,
} from './types';

export interface SessionSubmitTransactionRequest {
  actions: Array<{
    market_id: string;
    actions: Array<Record<string, any>>;
  }>;
  signature: any;
  nonce: string;
  trade_account_id: string;
  session_id: any;
  variable_outputs?: number;
  min_gas_limit?: string;
  collect_orders?: boolean;
}

export interface SessionSubmitTransactionResponse {
  tx_id: string;
  orders?: any[];
}

/**
 * Standalone O2 API client.
 *
 * All methods take `ownerIdB256` as a pre-computed B256 string for the
 * `O2-Owner-Id` header — no walletService dependency.
 */
export class O2ApiClient {
  private client: AxiosInstance;

  constructor(baseUrl: string) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 429 rate limiting retry interceptor (1s, 2s, 4s — max 3 retries)
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error.config;
        if (!config || !config._retryCount) {
          config._retryCount = 0;
        }
        if (error.response?.status === 429 && config._retryCount < 3) {
          config._retryCount += 1;
          const delay = Math.min(1000 * Math.pow(2, config._retryCount - 1), 4000);
          await new Promise((resolve) => setTimeout(resolve, delay));
          return this.client(config);
        }
        return Promise.reject(error);
      }
    );
  }

  async createTradingAccount(
    request: CreateTradingAccountRequest,
    ownerIdB256: string
  ): Promise<CreateTradingAccountResponse> {
    const response = await this.client.post<CreateTradingAccountResponse>('/accounts', request, {
      headers: { 'O2-Owner-Id': ownerIdB256 },
    });
    return response.data;
  }

  async getAccount(
    tradeAccountId: string,
    ownerIdB256: string
  ): Promise<{ nonce: string }> {
    const response = await this.client.get<GetAccountResponse>(
      `/accounts?trade_account_id=${tradeAccountId}`,
      { headers: { 'O2-Owner-Id': ownerIdB256 } }
    );
    return { nonce: String(response.data.trade_account?.nonce || 0) };
  }

  async getAccountByOwner(ownerAddress: string): Promise<GetAccountResponse> {
    const response = await this.client.get<GetAccountResponse>(
      `/accounts?owner=${ownerAddress}`
    );
    return response.data;
  }

  async createSession(
    request: API_CreateSessionRequest,
    ownerIdB256: string
  ): Promise<any> {
    const response = await this.client.put('/session', request, {
      headers: { 'O2-Owner-Id': ownerIdB256 },
    });
    return response.data;
  }

  async sessionSubmitTransaction(
    request: SessionSubmitTransactionRequest,
    ownerIdB256: string
  ): Promise<SessionSubmitTransactionResponse> {
    const response = await this.client.post<SessionSubmitTransactionResponse>(
      '/session/actions',
      request,
      { headers: { 'O2-Owner-Id': ownerIdB256 } }
    );
    return response.data;
  }
}
