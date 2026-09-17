import type { LibraryFile, LibraryFilePage } from '../../../../shared/library'
import { formatBytes, shortenPath } from '../../format'
import type { LibraryActions } from '../../hooks/useLibrary'

/** Indexed files, each with Open and Show. */
export function FileList({
  files,
  actions
}: {
  files: LibraryFile[]
  actions: Pick<LibraryActions, 'openFile' | 'showInFolder'>
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
          <span className="muted file-detail">{formatBytes(file.size)}</span>
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

/** "Showing 25 of 1,284" and, while there is more, a button to load the next page. */
export function ListFoot({
  page,
  onMore
}: {
  page: LibraryFilePage
  onMore: () => void
}): React.JSX.Element | null {
  if (page.total === 0) return null
  return (
    <div className="list-foot">
      <span className="muted">
        Showing {page.rows.length.toLocaleString()} of {page.total.toLocaleString()}
      </span>
      {page.rows.length < page.total && (
        <button className="btn btn-small" onClick={onMore}>
          Show more
        </button>
      )}
    </div>
  )
}
