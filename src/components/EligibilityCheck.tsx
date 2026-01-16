import { useTranslation } from 'react-i18next'
import './EligibilityCheck.css'

interface EligibilityCheckProps {
  isEligible: boolean | null
}

export default function EligibilityCheck({ isEligible }: EligibilityCheckProps) {
  const { t } = useTranslation()

  if (isEligible === null) {
    return (
      <div className="eligibility-check">
        <h2>{t('eligibility.title')}</h2>
        <div className="whitelist-tag loading">{t('eligibility.checking')}</div>
      </div>
    )
  }

  return (
    <div className="eligibility-check">
      <h2>{t('eligibility.title')}</h2>
      <div className={`whitelist-tag ${isEligible ? 'whitelisted' : 'not-whitelisted'}`}>
        {isEligible ? t('eligibility.whitelisted') : t('eligibility.not_whitelisted')}
        </div>
    </div>
  )
}

