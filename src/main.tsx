import React from 'react'
import ReactDOM from 'react-dom/client'
import { PostHogProvider } from 'posthog-js/react'
import './i18n' // Initialize i18n before App
import App from './App.tsx'
import { analyticsService } from './services/analyticsService'
import './index.css'

// Initialize analytics service on app load
analyticsService.initialize()

const posthogOptions = {
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
  defaults: '2025-11-30',
} as const

// Apply dark theme by default (matching o2 frontend)
document.documentElement.classList.add('dark')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PostHogProvider apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_KEY} options={posthogOptions}>
      <App />
    </PostHogProvider>
  </React.StrictMode>,
)

