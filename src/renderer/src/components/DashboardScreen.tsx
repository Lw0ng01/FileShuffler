import type { LibraryFilePage, LibraryView } from '../../../shared/library'
import { folderName, formatCount, joinNames, shortenPath } from '../format'
import type { LibraryActions, SearchFilters } from '../hooks/useLibrary'
import { FileList, ListFoot } from './dashboard/FileList'
import { FilterBar } from './dashboard/FilterBar'
import { Drives, Totals } from './dashboard/LibrarySummary'
import { DashboardIcon, FolderIcon } from './Icons'

interface Props {
  view: LibraryView | null
  largest: LibraryFilePage
  recent: LibraryFilePage
  results: LibraryFilePage | null
  filters: SearchFilters
  error: string | null
  actions: LibraryActions
  /** Opens Settings, where the indexed folders are managed. */
  onManageFolders: () => void
  /** Opens the Shuffle tab. */
  onShuffle: () => void
}

/**
 * The app opens here, but some people came for the shuffle and have no use for an index. Said once,
 * on the first-run cards only, so they are not left thinking a scan is required first.
 */
function ShuffleHint({ onShuffle }: { onShuffle: () => void }): React.JSX.Element {
  return (
    <p className="muted empty-hint">
      Just want to play a folder of videos?{' '}
      <button className="link-button" onClick={onShuffle}>
        Go to Shuffle
      </button>
    </p>
  )
}

/** The dashboard's layout. Each section lives in `dashboard/`. */
export function DashboardScreen({
  view,
  largest,
  recent,
  results,
  filters,
  error,
  actions,
  onManageFolders,
  onShuffle
}: Props): React.JSX.Element {
  if (view === null) return <p className="loading">Loading…</p>

  const scanning = view.status === 'scanning'
  const hasRoots = view.roots.length > 0
  // Once a scan starts, the normal layout shows it filling in; a cancelled first scan that found
  // something counts as scanned too.
  const neverScanned =
    !scanning && view.files === 0 && view.roots.every((root) => root.lastScanAt === null)

  return (
    <div className="screen wide">
      <header className="screen-header">
        <h1>Dashboard</h1>
        <div className="folder">
          {scanning ? (
            <button className="btn btn-small" onClick={actions.cancelScan}>
              Stop scan
            </button>
          ) : (
            <button className="btn btn-small" onClick={actions.scan} disabled={!hasRoots}>
              Scan now
            </button>
          )}
          <button className="btn btn-small" onClick={actions.chooseRoot}>
            <FolderIcon size={16} />
            Add folder
          </button>
          <button className="btn btn-small" onClick={onManageFolders}>
            Manage folders
          </button>
        </div>
      </header>

      {error !== null && (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      )}

      {scanning && view.progress !== null && (
        <div className="banner banner-notice" role="status">
          Scanning… {formatCount(view.progress.files)} in {view.progress.folders.toLocaleString()}{' '}
          folders
          <span className="muted"> · {shortenPath(view.progress.current)}</span>
        </div>
      )}

      {!hasRoots ? (
        <div className="card empty">
          <div className="empty-icon">
            <DashboardIcon size={28} />
          </div>
          <h2>Nothing indexed yet</h2>
          <p className="muted">
            Choose a folder and FileShuffler will catalogue the videos, photos, audio and documents
            inside it. It only reads: nothing is moved or changed.
          </p>
          <button className="btn btn-large btn-primary" onClick={actions.chooseRoot}>
            <FolderIcon />
            Choose folder
          </button>
          <ShuffleHint onShuffle={onShuffle} />
        </div>
      ) : neverScanned ? (
        // A first run lands here, not on the card above: the standard folders are added for a new
        // user, but nothing reads them until asked. Without this, the first thing anyone saw was a
        // row of zeros and "Nothing here yet", with the way forward a small button in the corner.
        <div className="card empty">
          <div className="empty-icon">
            <DashboardIcon size={28} />
          </div>
          <h2>Ready when you are</h2>
          <p className="muted">
            A scan reads {joinNames(view.roots.map((root) => folderName(root.path)))} and shows what
            is taking up space. It only reads: nothing is moved or changed.
          </p>
          <div className="empty-actions">
            <button className="btn btn-large btn-primary" onClick={actions.scan}>
              Scan these folders
            </button>
            <button className="btn btn-large" onClick={onManageFolders}>
              Choose different folders
            </button>
          </div>
          <ShuffleHint onShuffle={onShuffle} />
        </div>
      ) : (
        <>
          <Totals view={view} />
          <Drives view={view} />

          <section className="dash-section" aria-label="Search">
            <h2 className="section-title">Search</h2>
            <input
              className="search"
              type="search"
              value={filters.term}
              placeholder="Find a file by name"
              aria-label="Find a file by name"
              onChange={(event) => actions.setTerm(event.target.value)}
            />
            <FilterBar view={view} filters={filters} actions={actions} />
            {results !== null &&
              (results.total === 0 ? (
                <p className="muted">Nothing matches these filters.</p>
              ) : (
                <>
                  <FileList files={results.rows} actions={actions} />
                  <ListFoot page={results} onMore={actions.showMoreResults} />
                </>
              ))}
          </section>

          {results === null && (
            <div className="two-col">
              <section className="dash-section" aria-label="Largest files">
                <h2 className="section-title">Largest</h2>
                <FileList files={largest.rows} actions={actions} />
                <ListFoot page={largest} onMore={actions.showMoreLargest} />
              </section>
              <section className="dash-section" aria-label="Recently changed files">
                <h2 className="section-title">Recently changed</h2>
                <FileList files={recent.rows} actions={actions} />
                <ListFoot page={recent} onMore={actions.showMoreRecent} />
              </section>
            </div>
          )}
        </>
      )}
    </div>
  )
}
