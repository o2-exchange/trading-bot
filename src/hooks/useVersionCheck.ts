import { useState, useEffect, useCallback } from 'react'
import { CURRENT_VERSION } from '../constants/releaseNotes'

const STORAGE_KEY = 'o2-trading-bot-seen-version'

interface UseVersionCheckResult {
  shouldShowReleaseNotes: boolean
  markVersionAsSeen: () => void
}

export function useVersionCheck(authReady: boolean): UseVersionCheckResult {
  const [shouldShowReleaseNotes, setShouldShowReleaseNotes] = useState(() => {
    // Check immediately on mount if authReady starts as true
    if (authReady) {
      const seenVersion = localStorage.getItem(STORAGE_KEY)
      return seenVersion !== CURRENT_VERSION
    }
    return false
  })

  useEffect(() => {
    // Only check after auth is ready to avoid showing during login flow
    if (!authReady) return

    const seenVersion = localStorage.getItem(STORAGE_KEY)

    // Show dialog if user hasn't seen this version yet
    if (seenVersion !== CURRENT_VERSION) {
      setShouldShowReleaseNotes(true)
    }
  }, [authReady])

  const markVersionAsSeen = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, CURRENT_VERSION)
    setShouldShowReleaseNotes(false)
  }, [])

  return {
    shouldShowReleaseNotes,
    markVersionAsSeen,
  }
}
