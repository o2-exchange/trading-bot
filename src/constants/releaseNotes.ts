export interface ReleaseFeature {
  title: string       // i18n key for feature title
  description: string // i18n key for narrative description
  details?: string[]  // optional i18n keys for bullet points
}

export interface ReleaseNote {
  version: string
  date: string
  features: ReleaseFeature[]
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '1.4.0',
    date: '2026-01-29',
    features: [
      {
        title: 'release_notes.jan_29.pnl_title',
        description: 'release_notes.jan_29.pnl_desc',
      },
      {
        title: 'release_notes.jan_29.orders_title',
        description: 'release_notes.jan_29.orders_desc',
      },
      {
        title: 'release_notes.jan_29.stability_title',
        description: 'release_notes.jan_29.stability_desc',
      },
    ],
  },
  {
    version: '1.3.0',
    date: '2026-01-26',
    features: [
      {
        title: 'release_notes.jan_26.rewards_title',
        description: 'release_notes.jan_26.rewards_desc',
      },
      {
        title: 'release_notes.jan_26.performance_title',
        description: 'release_notes.jan_26.performance_desc',
      },
      {
        title: 'release_notes.jan_26.slippage_title',
        description: 'release_notes.jan_26.slippage_desc',
      },
      {
        title: 'release_notes.jan_26.fixes_title',
        description: 'release_notes.jan_26.fixes_desc',
        details: [
          'release_notes.jan_26.fix_session',
          'release_notes.jan_26.fix_tab_warning',
        ],
      },
    ],
  },
  {
    version: '1.2.0',
    date: '2026-01-21',
    features: [
      {
        title: 'release_notes.jan_21.language_title',
        description: 'release_notes.jan_21.language_desc',
      },
      {
        title: 'release_notes.jan_21.leaderboard_title',
        description: 'release_notes.jan_21.leaderboard_desc',
      },
    ],
  },
  {
    version: '1.1.0',
    date: '2026-01-14',
    features: [
      {
        title: 'release_notes.jan_14.tutorials_title',
        description: 'release_notes.jan_14.tutorials_desc',
      },
      {
        title: 'release_notes.jan_14.walletconnect_title',
        description: 'release_notes.jan_14.walletconnect_desc',
      },
      {
        title: 'release_notes.jan_14.analytics_title',
        description: 'release_notes.jan_14.analytics_desc',
      },
    ],
  },
  {
    version: '1.0.1',
    date: '2026-01-12',
    features: [
      {
        title: 'release_notes.jan_12.usdt_title',
        description: 'release_notes.jan_12.usdt_desc',
      },
      {
        title: 'release_notes.jan_12.export_title',
        description: 'release_notes.jan_12.export_desc',
      },
      {
        title: 'release_notes.jan_12.loss_title',
        description: 'release_notes.jan_12.loss_desc',
      },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-01-04',
    features: [
      {
        title: 'release_notes.jan_04.initial_title',
        description: 'release_notes.jan_04.initial_desc',
      },
    ],
  },
]

export const CURRENT_VERSION = __APP_VERSION__
