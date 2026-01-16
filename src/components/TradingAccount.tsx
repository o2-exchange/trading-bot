import { useTranslation } from 'react-i18next'
import './TradingAccount.css'

export default function TradingAccount() {
  const { t } = useTranslation()

  return (
    <div className="trading-account">
      <h2>{t('trading.panel_title')}</h2>
    </div>
  )
}

