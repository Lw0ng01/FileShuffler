import type { LibraryView } from '../../../../shared/library'
import { formatBytes, formatCount, formatWhen, shortenPath } from '../../format'
import type { LibraryActions } from '../../hooks/useLibrary'
import { FolderIcon, TrashIcon } from '../Icons'

export type FolderActions = Pick<
  LibraryActions,
  | 'chooseRoot'
  | 'removeRoot'
  | 'chooseExcluded'
  | 'removeExcluded'
  | 'scan'
  | 'scanRoot'
  | 'cancelScan'
>

interface Props {
  library: LibraryView
  actions: FolderActions
}

/** The folders the index reads, each with its own rescan. */
export function IndexedFolders({ library, actions }: Props): React.JSX.Element {
  const scanning = library.status === 'scanning'
  return (
    <section className="dash-section" aria-label="Indexed folders">
      <div className="section-head">
        <h2 className="section-title">Indexed folders</h2>
        <span className="settings-actions">
          {scanning ? (
            <button className="btn btn-small" onClick={actions.cancelScan}>
              Stop scan
            </button>
          ) : (
            <button
              className="btn btn-small"
              onClick={actions.scan}
              disabled={library.roots.length === 0}
            >
              Scan all
            </button>
          )}
          <button className="btn btn-small" onClick={actions.chooseRoot}>
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
                onClick={() => actions.scanRoot(root.path)}
                disabled={scanning}
              >
                Rescan
              </button>
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
      )}
    </section>
  )
}

/** Folders every scan skips. Changing them waits for a running scan to stop. */
export function ExcludedFolders({ library, actions }: Props): React.JSX.Element {
  const scanning = library.status === 'scanning'
  return (
    <section className="dash-section" aria-label="Excluded folders">
      <div className="section-head">
        <h2 className="section-title">Excluded folders</h2>
        <span className="settings-actions">
          <button
            className="btn btn-small"
            onClick={actions.chooseExcluded}
            disabled={scanning}
            title={scanning ? 'Stop the scan first' : undefined}
          >
            <FolderIcon size={16} />
            Exclude folder
          </button>
        </span>
      </div>
      <p className="muted">
        Scans skip these folders and everything inside them, for example a game library. Excluding a
        folder removes it from the dashboard straight away; your files stay where they are.
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
                onClick={() => actions.removeExcluded(path)}
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
  )
}
