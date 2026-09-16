import type {
  LibraryCategory,
  LibraryDigest,
  LibraryDuplicateGroup,
  LibraryFile,
  LibraryView
} from '../../../shared/library'
import {
  duplicateKey,
  STALE_DAYS,
  type CleanupLists,
  type LibraryActions
} from '../hooks/useLibrary'
import { formatBytes, formatCount, formatWhen, shortenPath } from '../format'
import { DashboardIcon, FolderIcon, TrashIcon } from './Icons'

interface Props {
  view: LibraryView | null
  largest: LibraryFile[]
  recent: LibraryFile[]
  results: LibraryFile[] | null
  term: string
  error: string | null
  cleanup: CleanupLists
  actions: LibraryActions
}

const CATEGORY_LABELS: Record<LibraryCategory, string> = {
  video: 'Video',
  photo: 'Photos',
  audio: 'Audio',
  document: 'Documents'
}

const CATEGORY_ORDER: LibraryCategory[] = ['video', 'photo', 'audio', 'document']

export function DashboardScreen({
  view,
  largest,
  recent,
  results,
  term,
  error,
  cleanup,
  actions
}: Props): React.JSX.Element {
  if (view === null) return <p className="loading">Loading…</p>

  const scanning = view.status === 'scanning'
  const hasRoots = view.roots.length > 0

  return (
    <div className="screen">
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
        </div>
      ) : (
        <>
          <Totals view={view} />
          <Drives view={view} />

          <section className="dash-section" aria-label="Indexed folders">
            <h2 className="section-title">Indexed folders</h2>
            <ul className="roots">
              {view.roots.map((root) => (
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
                    onClick={() => actions.removeRoot(root.path)}
                    disabled={scanning}
                    title="Forget this folder and everything indexed under it"
                  >
                    <TrashIcon size={16} />
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="dash-section" aria-label="Search">
            <h2 className="section-title">Search</h2>
            <input
              className="search"
              type="search"
              value={term}
              placeholder="Find a file by name"
              aria-label="Find a file by name"
              onChange={(event) => actions.setTerm(event.target.value)}
            />
            {results !== null &&
              (results.length === 0 ? (
                <p className="muted">Nothing matches “{term.trim()}”.</p>
              ) : (
                <FileList files={results} actions={actions} />
              ))}
          </section>

          {results === null && (
            <div className="two-col">
              <section className="dash-section" aria-label="Largest files">
                <h2 className="section-title">Largest</h2>
                <FileList files={largest} actions={actions} />
              </section>
              <section className="dash-section" aria-label="Recently changed files">
                <h2 className="section-title">Recently changed</h2>
                <FileList files={recent} actions={actions} />
              </section>
            </div>
          )}

          {results === null && <Cleanup cleanup={cleanup} actions={actions} />}
        </>
      )}
    </div>
  )
}

function Totals({ view }: { view: LibraryView }): React.JSX.Element {
  const totals = CATEGORY_ORDER.map(
    (category) =>
      view.totals.find((total) => total.category === category) ?? {
        category,
        files: 0,
        bytes: 0
      }
  )
  return (
    <div className="card">
      <p className="eyebrow">Indexed</p>
      <p className="now-title">
        {formatBytes(view.bytes)} <span className="muted">· {formatCount(view.files)}</span>
      </p>
      <div className="split" role="img" aria-label="Space by category">
        {totals.map((total) => (
          <div
            key={total.category}
            className={`split-part ${total.category}`}
            style={{ flexGrow: Math.max(total.bytes, view.bytes === 0 ? 1 : 0) }}
            title={`${CATEGORY_LABELS[total.category]}: ${formatBytes(total.bytes)}`}
          />
        ))}
      </div>
      <ul className="legend">
        {totals.map((total) => (
          <li key={total.category}>
            <span className={`legend-dot ${total.category}`} />
            {CATEGORY_LABELS[total.category]}
            <span className="muted">
              {' '}
              {formatBytes(total.bytes)} · {formatCount(total.files)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Drives({ view }: { view: LibraryView }): React.JSX.Element | null {
  if (view.drives.length === 0) return null
  return (
    <section className="dash-section" aria-label="Drives">
      <h2 className="section-title">Drives</h2>
      <div className="drive-grid">
        {view.drives.map((drive) => {
          const known = drive.total !== null && drive.free !== null
          const used = known ? (drive.total as number) - (drive.free as number) : 0
          const usedPercent = known ? Math.min(100, (used / (drive.total as number)) * 100) : 0
          const indexedPercent = known
            ? Math.min(100, (drive.bytes / (drive.total as number)) * 100)
            : 0
          return (
            <div className="card drive-card" key={drive.drive}>
              <p className="eyebrow">{drive.drive}</p>
              {known ? (
                <>
                  <p className="drive-line">
                    {formatBytes(drive.free as number)} free
                    <span className="muted"> of {formatBytes(drive.total as number)}</span>
                  </p>
                  <div
                    className="meter"
                    role="img"
                    aria-label={`${Math.round(usedPercent)}% of ${drive.drive} used`}
                  >
                    <div className="meter-used" style={{ width: `${usedPercent}%` }} />
                    <div className="meter-indexed" style={{ width: `${indexedPercent}%` }} />
                  </div>
                </>
              ) : (
                <p className="drive-line muted">Size unavailable</p>
              )}
              <p className="muted">
                {formatBytes(drive.bytes)} indexed · {formatCount(drive.files)}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** What a fingerprint check concluded about one group of lookalike files. */
function verdict(digests: LibraryDigest[]): string {
  const readable = digests.filter((entry) => entry.digest !== null)
  const unreadable = digests.length - readable.length
  const distinct = new Set(readable.map((entry) => entry.digest)).size
  if (readable.length < 2) return 'Could not read enough of these files to compare them.'
  const note = unreadable > 0 ? ` ${unreadable} could not be read.` : ''
  if (distinct === 1) {
    return `Same size, and identical at the start and end, so these look like real copies.${note}`
  }
  return `Not copies: ${distinct} different versions share this name and size.${note}`
}

function Cleanup({
  cleanup,
  actions
}: {
  cleanup: CleanupLists
  actions: LibraryActions
}): React.JSX.Element {
  return (
    <section className="dash-section" aria-label="Cleanup">
      <h2 className="section-title">Cleanup</h2>
      {!cleanup.loaded ? (
        <>
          <p className="muted">
            Find the folders using the most space, files that look like copies of each other, and
            big files nothing has changed in months. Nothing is deleted here: use Open or Show and
            decide for yourself.
          </p>
          <button className="btn btn-small" onClick={actions.loadCleanup}>
            Look for space to reclaim
          </button>
        </>
      ) : (
        <>
          <button className="btn btn-small" onClick={actions.loadCleanup}>
            Refresh
          </button>

          <h3 className="sub-title">Biggest folders</h3>
          {cleanup.folders.length === 0 ? (
            <p className="muted">Nothing indexed yet.</p>
          ) : (
            <ul className="files">
              {cleanup.folders.map((folder) => (
                <li className="file-row" key={folder.folder}>
                  <FolderIcon size={16} />
                  <span className="file-name" title={folder.folder}>
                    {shortenPath(folder.folder)}
                  </span>
                  <span className="muted file-folder">{formatCount(folder.files)}</span>
                  <span className="muted">{formatBytes(folder.bytes)}</span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="sub-title">Possible duplicates</h3>
          {cleanup.duplicates.length === 0 ? (
            <p className="muted">No files share a name and size.</p>
          ) : (
            <ul className="dupes">
              {cleanup.duplicates.map((group) => (
                <DuplicateGroupRow
                  key={duplicateKey(group.name, group.size)}
                  group={group}
                  cleanup={cleanup}
                  actions={actions}
                />
              ))}
            </ul>
          )}

          <h3 className="sub-title">Not touched in {Math.round(STALE_DAYS / 30)} months</h3>
          {cleanup.stale.length === 0 ? (
            <p className="muted">Everything indexed has changed recently.</p>
          ) : (
            <FileList files={cleanup.stale} actions={actions} />
          )}
        </>
      )}
    </section>
  )
}

function DuplicateGroupRow({
  group,
  cleanup,
  actions
}: {
  group: LibraryDuplicateGroup
  cleanup: CleanupLists
  actions: LibraryActions
}): React.JSX.Element {
  const key = duplicateKey(group.name, group.size)
  const digests = cleanup.checked[key]
  const checking = cleanup.checking === key
  return (
    <li className="dupe">
      <div className="dupe-head">
        <span className="file-name" title={group.name}>
          {group.name}
        </span>
        <span className="muted">
          {group.files.length} copies · {formatBytes(group.size)} each ·{' '}
          {formatBytes(group.wastedBytes)} wasted
        </span>
        <button
          className="btn btn-small"
          onClick={() => actions.checkDuplicate(group.name, group.size)}
          disabled={checking}
        >
          {checking ? 'Checking…' : digests === undefined ? 'Check' : 'Check again'}
        </button>
      </div>
      {digests !== undefined && <p className="muted dupe-verdict">{verdict(digests)}</p>}
      <FileList files={group.files} actions={actions} />
    </li>
  )
}

function FileList({
  files,
  actions
}: {
  files: LibraryFile[]
  actions: LibraryActions
}): React.JSX.Element {
  if (files.length === 0) return <p className="muted">Nothing here yet.</p>
  return (
    <ul className="files">
      {files.map((file) => (
        <li key={file.path} className="file-row">
          <span className={`legend-dot ${file.category}`} />
          <span className="file-name" title={file.path}>
            {file.name}
          </span>
          <span className="muted file-folder" title={file.folder}>
            {shortenPath(file.folder)}
          </span>
          <span className="muted">{formatBytes(file.size)}</span>
          <span className="row-actions">
            <button
              className="btn btn-small"
              onClick={() => actions.openFile(file.path)}
              title={`Open ${file.name}`}
            >
              Open
            </button>
            <button
              className="btn btn-small"
              onClick={() => actions.showInFolder(file.path)}
              title="Show this file in the file manager"
            >
              Show
            </button>
          </span>
        </li>
      ))}
    </ul>
  )
}
