import axios from 'axios'
import { O2_ANALYTICS_API_URL } from '../constants/o2Constants'

export interface WhitelistResponse {
  success: boolean
  tradeAccount: string
  alreadyWhitelisted?: boolean
}

class EligibilityService {
  /**
   * Whitelist a trading account via the analytics API.
   * This is called during onboarding to ensure the trading account is whitelisted
   * at the contract level before creating a session.
   *
   * @param tradingAccountId - The trading account address to whitelist
   * @returns WhitelistResponse with success status
   */
  async whitelistTradingAccount(tradingAccountId: string): Promise<WhitelistResponse> {
    try {
      const response = await axios.post<WhitelistResponse>(
        `${O2_ANALYTICS_API_URL}/whitelist`,
        {
          tradeAccount: tradingAccountId,
        }
      )

      return response.data
    } catch (error: any) {
      // If already whitelisted, that's fine
      if (error.response?.data?.alreadyWhitelisted) {
        return {
          success: true,
          tradeAccount: tradingAccountId,
          alreadyWhitelisted: true,
        }
      }

      console.error('[EligibilityService] Failed to whitelist trading account:', error)
      throw new Error(error.response?.data?.message || 'Failed to whitelist trading account')
    }
  }

  /**
   * Get referral code from URL if present.
   * Note: This is kept for referral tracking purposes, not for access control.
   */
  getReferralCodeFromUrl(): string | null {
    const params = new URLSearchParams(window.location.search)
    return params.get('ref') || params.get('invite')
  }
}

export const eligibilityService = new EligibilityService()
