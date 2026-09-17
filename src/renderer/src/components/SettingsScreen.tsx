import { useState } from 'react'
import type { LibraryView } from '../../../shared/library'
import type {
  Appearance,
  ClearableData,
  MpvSource,
  PlayerChoice,
  SettingsView
} from '../../../shared/settings'
import { formatBytes, formatCount, formatWhen, shortenPath } from '../format'
import type { LibraryActions } from '../hooks/useLibrary'
import type { SettingsActions } from '../hooks/useSettings'
import { FolderIcon, TrashIcon } from './Icons'

interface Props {
  view: SettingsView | null
  error: string | null
  actions: SettingsActions
  library: LibraryView | null
  libraryActions: Pick<
    LibraryActions,
    | 'chooseRoot'
    | 'removeRoot'
    | 'chooseExcluded'
    | 'removeExcluded'
    | 'scan'
    | 'scanRoot'
    | 'cancelScan'
  >
}

const SOURCE_LABELS: Record<MpvSource, string> = {
  environment: 'Set by the FILESHUFFLER_MPV environment variable',
  settings: 'Chosen here',
  bundled: 'Bundled with FileShuffler',
  installed: 'Found in a standard install location',
  path: 'Looked up on the system PATH'
}

const APPEARANCES: { value: Appearance; label: string }[] = [
  { value: 'system', label: 'Automatic' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

const PLAYERS: { value: PlayerChoice; label: string; detail: string }[] = [
  {
    value: 'builtin',
    label: 'Built-in',
    detail: 'Plays inside the app, with the same look on every screen.'
  },
  {
    value: 'mpv',
    label: 'mpv',
    detail:
      'Opens mpv in its own window. Needs mpv installed, and plays formats the built-in one cannot.'
  }
]

interface Clearable {
  what: ClearableData
  title: string
  detail: string
}

const CLEARABLE: Clearable[] = [
  {
    what: 'plays',
    title: 'Play history',
    detail: 'Every play and finish the Stats tab counts. Favorites stay.'
  },
  {
    what: 'favorites',
    title: 'Favorites',
    detail: 'Your starred files. Play history stays.'
  },
  {
    what: 'progress',
    title: 'Saved shuffle progress',
    detail: "Where each folder's cycle got to, and which folder reopens at startup."
  },
  {
    what: 'index',
    title: 'The index',
    detail: 'Everything catalogued from your folders. The folder list stays, so a scan rebuilds it.'
  }
]

export function SettingsScreen({
  view,
  error,
  actions,
  library,
  libraryActions
}: Props): React.JSX.Element {
  if (view === null || library === null) return <p className="loading">Loading…</p>

  const scanning = library.status === 'scanning'
  const shownError = error ?? view.lastError
  const { mpv } = view

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

      <section className="dash-section" aria-label="Indexed folders">
        <div className="section-head">
          <h2 className="section-title">Indexed folders</h2>
          <span className="settings-actions">
            {scanning ? (
              <button className="btn btn-small" onClick={libraryActions.cancelScan}>
                Stop scan
              </button>
            ) : (
              <button
                className="btn btn-small"
                onClick={libraryActions.scan}
                disabled={library.roots.length === 0}
              >
                Scan all
              </button>
            )}
            <button className="btn btn-small" onClick={libraryActions.chooseRoot}>
              <FolderIcon size={16} />
              Add folder
            </button>
          </span>
        </div>
        <p className="muted">
          The dashboard, cleanup tools and Never played draw on these folders. Scanning only reads
          them.
        </p>
        {library.roots.length === 0 ? (
          <p className="muted">No folders yet.</p>
        ) : (
          <ul className="roots">
            {library.roots.map((root) => (
              <li className="root-row" key={root.path}>
                <FolderIcon size={16} />
                <span className="root-path" title={root.path}>
                  {shortenPath(root.path)}
                </span>
                <span className="muted">
                  {formatCount(root.files)} · {formatBytes(root.bytes)} ·{' '}
                  {formatWhen(root.lastScanAt, 'never scanned')}
                </span>
                <button
                  className="btn btn-small"
                  onClick={() => libraryActions.scanRoot(root.path)}
                  disabled={scanning}
                >
                  Rescan
                </button>
                <button
                  className="btn btn-small"
                  onClick={() => libraryActions.removeRoot(root.path)}
                  disabled={scanning}
                  title="Forget this folder and everything indexed under it"
                >
                  <TrashIcon size={16} />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dash-section" aria-label="Excluded folders">
        <div className="section-head">
          <h2 className="section-title">Excluded folders</h2>
          <span className="settings-actions">
            <button
              className="btn btn-small"
              onClick={libraryActions.chooseExcluded}
              disabled={scanning}
              title={scanning ? 'Stop the scan first' : undefined}
            >
              <FolderIcon size={16} />
              Exclude folder
            </button>
          </span>
        </div>
        <p className="muted">
          Scans skip these folders and everything inside them, for example a game library. Excluding
          a folder removes it from the dashboard straight away; your files stay where they are.
        </p>
        {library.excluded.length === 0 ? (
          <p className="muted">Nothing excluded.</p>
        ) : (
          <ul className="roots">
            {library.excluded.map((path) => (
              <li className="root-row" key={path}>
                <FolderIcon size={16} />
                <span className="root-path" title={path}>
                  {shortenPath(path)}
                </span>
                <button
                  className="btn btn-small"
                  onClick={() => libraryActions.removeExcluded(path)}
                  disabled={scanning}
                  title="Include this folder again; the next scan brings its files back"
                >
                  Include again
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dash-section" aria-label="Appearance">
        <h2 className="section-title">Appearance</h2>
        <p className="muted">
          Automatic follows this computer&rsquo;s light or dark setting. Choosing one here overrides
          it for FileShuffler only.
        </p>
        <div className="segmented" role="group" aria-label="Appearance">
          {APPEARANCES.map((option) => (
            <button
              key={option.value}
              className={`segment${view.appearance === option.value ? ' on' : ''}`}
              aria-pressed={view.appearance === option.value}
              onClick={() => actions.setAppearance(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="dash-section" aria-label="Player">
        <h2 className="section-title">Player</h2>
        <p className="muted">{PLAYERS.find((p) => p.value === view.player)?.detail}</p>
        <div className="segmented" role="group" aria-label="Player">
          {PLAYERS.map((option) => (
            <button
              key={option.value}
              className={`segment${view.player === option.value ? ' on' : ''}`}
              aria-pressed={view.player === option.value}
              onClick={() => actions.setPlayer(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="card settings-card">
          <p className="eyebrow">mpv</p>
          <p className="setting-path" title={mpv.path}>
            {mpv.path}
          </p>
          <p className="muted">{SOURCE_LABELS[mpv.source]}</p>
          {mpv.test !== null && (
            <p className={mpv.test.ok ? 'ok-text' : 'warning-text'}>
              {mpv.test.ok ? `Works: ${mpv.test.message}` : `Doesn't work: ${mpv.test.message}`}
            </p>
          )}
          <div className="settings-actions">
            <button className="btn btn-small" onClick={actions.chooseMpv}>
              Choose mpv…
            </button>
            <button className="btn btn-small" onClick={actions.testMpv} disabled={mpv.testing}>
              {mpv.testing ? 'Testing…' : 'Test'}
            </button>
            {mpv.chosen !== null && (
              <button className="btn btn-small" onClick={actions.useDefaultMpv}>
                Find automatically
              </button>
            )}
          </div>
          {mpv.source === 'environment' && (
            <p className="muted">FILESHUFFLER_MPV is set, so it overrides any choice made here.</p>
          )}
        </div>
      </section>

      <section className="dash-section" aria-label="Privacy">
        <h2 className="section-title">Privacy</h2>
        <p className="muted">
          All of this stays on this computer. Clearing one kind of data never touches the others,
          and never touches your files.
        </p>
        <ul className="roots">
          {CLEARABLE.map((item) => (
            <ClearRow
              key={item.what}
              item={item}
              disabled={item.what === 'index' && scanning}
              onClear={() => actions.clearData(item.what)}
            />
          ))}
        </ul>
      </section>
    </div>
  )
}

function ClearRow({
  item,
  disabled,
  onClear
}: {
  item: Clearable
  disabled: boolean
  onClear: () => void
}): React.JSX.Element {
  // Clearing can't be undone, so it asks first rather than acting on one click.
  const [confirming, setConfirming] = useState(false)
  return (
    <li className="root-row">
      <span className="clear-text">
        <span className="root-path">{item.title}</span>
        <span className="muted">{item.detail}</span>
      </span>
      {confirming ? (
        <span className="settings-actions">
          <span className="muted">This can&rsquo;t be undone.</span>
          <button
            className="btn btn-small btn-danger"
            onClick={() => {
              setConfirming(false)
              onClear()
            }}
          >
            Clear
          </button>
          <button className="btn btn-small" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </span>
      ) : (
        <button
          className="btn btn-small"
          onClick={() => setConfirming(true)}
          disabled={disabled}
          title={disabled ? 'Stop the scan first' : undefined}
        >
          Clear…
        </button>
      )}
    </li>
  )
}
