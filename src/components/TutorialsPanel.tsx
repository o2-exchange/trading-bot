import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Plyr } from 'plyr-react'
import 'plyr-react/plyr.css'
import './TutorialsPanel.css'

interface Tutorial {
  id: string
  title: string
  description: string
  youtubeId: string
}

const tutorials: Tutorial[] = [
  {
    id: 'o2-bot-intro',
    title: 'Getting Started with o2 Trading Bot',
    description: 'Your new trading companion! Connect your wallet, create or import a strategy, pick your market pairs, and hit Start Trading. Access Simple, Volume Max, and Profit-Taking presets, or build a fully custom strategy with all the variables your way.',
    youtubeId: '4XYdBMaBwow'
  }
]

const plyrOptions: Plyr.Options = {
  controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'fullscreen'],
  hideControls: true,
  clickToPlay: true,
  youtube: {
    noCookie: true,
    rel: 0,
    showinfo: 0,
    iv_load_policy: 3,
    modestbranding: 1,
    controls: 0,
    disablekb: 1,
    fs: 0,
    playsinline: 1
  }
}

export default function TutorialsPanel() {
  const { t } = useTranslation()
  const [selectedTutorial, setSelectedTutorial] = useState<Tutorial | null>(null)
  const [isPlayerReady, setIsPlayerReady] = useState(false)

  const handleBack = () => {
    setSelectedTutorial(null)
    setIsPlayerReady(false)
  }

  // Delay showing the player to let Plyr initialize and hide YouTube UI
  useEffect(() => {
    if (selectedTutorial) {
      setIsPlayerReady(false)
      const timer = setTimeout(() => {
        setIsPlayerReady(true)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [selectedTutorial])

  // Detail view when a tutorial is selected
  if (selectedTutorial) {
    return (
      <div className="tutorials-panel">
        <button className="back-button" onClick={handleBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          {t('tutorials.back_to_tutorials')}
        </button>

        <div className="tutorial-detail">
          <div className={`tutorial-detail-video ${isPlayerReady ? 'ready' : 'loading'}`}>
            {!isPlayerReady && (
              <div className="video-loading-overlay">
                <img
                  src={`https://img.youtube.com/vi/${selectedTutorial.youtubeId}/maxresdefault.jpg`}
                  alt={selectedTutorial.title}
                  className="video-loading-thumbnail"
                  onError={(e) => {
                    e.currentTarget.src = `https://img.youtube.com/vi/${selectedTutorial.youtubeId}/hqdefault.jpg`
                  }}
                />
                <div className="video-loading-spinner"></div>
              </div>
            )}
            <Plyr
              source={{
                type: 'video',
                sources: [
                  {
                    src: selectedTutorial.youtubeId,
                    provider: 'youtube'
                  }
                ]
              }}
              options={plyrOptions}
            />
          </div>

          <div className="tutorial-detail-content">
            <div className="tutorial-detail-info">
              <h2 className="tutorial-detail-title">{selectedTutorial.title}</h2>
              <p className="tutorial-detail-description">{selectedTutorial.description}</p>
            </div>

            <div className="quick-start-section">
              <h3>{t('tutorials.quick_start_title')}</h3>
              <ol className="quick-start-steps">
                <li>
                  <span className="step-title">{t('tutorials.step1_title')}</span>
                  <span className="step-desc">{t('tutorials.step1_desc')}</span>
                </li>
                <li>
                  <span className="step-title">{t('tutorials.step2_title')}</span>
                  <span className="step-desc">{t('tutorials.step2_desc')}</span>
                </li>
                <li>
                  <span className="step-title">{t('tutorials.step3_title')}</span>
                  <span className="step-desc">{t('tutorials.step3_desc')}</span>
                </li>
                <li>
                  <span className="step-title">{t('tutorials.step4_title')}</span>
                  <span className="step-desc">{t('tutorials.step4_desc')}</span>
                </li>
                <li>
                  <span className="step-title">{t('tutorials.step5_title')}</span>
                  <span className="step-desc">{t('tutorials.step5_desc')}</span>
                </li>
                <li>
                  <span className="step-title">{t('tutorials.step6_title')}</span>
                  <span className="step-desc">{t('tutorials.step6_desc')}</span>
                </li>
              </ol>
              <p className="quick-start-note">
                {t('tutorials.quick_start_note')}
              </p>
              <p className="experimental-warning">
                {t('tutorials.experimental_warning')}
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Grid view (default)
  return (
    <div className="tutorials-panel">
      <div className="tutorials-header">
        <h2>{t('tutorials.title')}</h2>
        <p className="tutorials-subtitle">{t('tutorials.subtitle')}</p>
      </div>

      <div className="tutorials-grid">
        {tutorials.map((tutorial) => (
          <div
            key={tutorial.id}
            className="tutorial-card"
            onClick={() => setSelectedTutorial(tutorial)}
          >
            <div className="video-thumbnail">
              <img
                src={`https://img.youtube.com/vi/${tutorial.youtubeId}/hqdefault.jpg`}
                alt={tutorial.title}
                className="thumbnail-image"
                onError={(e) => {
                  e.currentTarget.src = `https://img.youtube.com/vi/${tutorial.youtubeId}/mqdefault.jpg`
                }}
              />
              <div className="play-overlay">
                <div className="play-button">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </div>
              </div>
            </div>
            <div className="tutorial-info">
              <h3 className="tutorial-title">{tutorial.title}</h3>
              <p className="tutorial-description">{tutorial.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
