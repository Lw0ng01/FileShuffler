import type { LibraryView } from '../../../shared/library'
import type { Appearance, SettingsView } from '../../../shared/settings'
import type { SettingsActions } from '../hooks/useSettings'
import { ExcludedFolders, IndexedFolders, type FolderActions } from './settings/FolderSections'
import { PlayerSection } from './settings/PlayerSection'
import { PrivacySection } from './settings/PrivacySection'
import { Segmented } from './settings/Segmented'

interface Props {
  view: SettingsView | null
  error: string | null
  actions: SettingsActions
  library: LibraryView | null
  libraryActions: FolderActions
}

const APPEARANCES: { value: Appearance; label: string }[] = [
  { value: 'system', label: 'Automatic' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

/** The Settings layout. Each section lives in `settings/`. */
export function SettingsScreen({
  view,
  error,
  actions,
  library,
  libraryActions
}: Props): React.JSX.Element {
  if (view === null || library === null) return <p className="loading">Loading…</p>

  const shownError = error ?? view.lastError

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Settings</h1>
      </header>

      {shownError !== null && (
        <div className="banner banner-error" role="alert">
          {shownError}
        </div>
      )}
      {view.lastNotice !== null && (
        <div className="banner banner-notice" role="status">
          {view.lastNotice}
        </div>
      )}

      <IndexedFolders library={library} actions={libraryActions} />
      <ExcludedFolders library={library} actions={libraryActions} />

      <section className="dash-section" aria-label="Appearance">
        <h2 className="section-title">Appearance</h2>
        <p className="muted">
          Automatic follows this computer&rsquo;s light or dark setting. Choosing one here overrides
          it for FileShuffler only.
        </p>
        <Segmented
          label="Appearance"
          options={APPEARANCES}
          value={view.appearance}
          onChange={actions.setAppearance}
        />
      </section>

      <PlayerSection view={view} actions={actions} />
      <PrivacySection scanning={library.status === 'scanning'} onClear={actions.clearData} />
    </div>
  )
}
