import type { LibraryDigest, LibraryDuplicateGroup } from '../../../../shared/library'
import { formatBytes, formatCount, shortenPath } from '../../format'
import {
  duplicateKey,
  STALE_DAYS,
  type CleanupLists,
  type LibraryActions
} from '../../hooks/useLibrary'
import { FolderIcon } from '../Icons'
import { FileList } from './FileList'

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

/**
 * Biggest folders, possible duplicates and files untouched for months. Loads only when asked,
 * since the lists cost queries. Nothing here deletes anything.
 */
export function CleanupSection({
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
            <>
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
              {cleanup.folders.length >= cleanup.folderLimit && (
                <div className="list-foot">
                  <button className="btn btn-small" onClick={actions.showMoreFolders}>
                    Show more folders
                  </button>
                </div>
              )}
            </>
          )}

          <h3 className="sub-title">Possible duplicates</h3>
          {cleanup.duplicates.length === 0 ? (
            <p className="muted">No files share a name and size.</p>
          ) : (
            <>
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
              {cleanup.duplicates.length >= cleanup.duplicateLimit && (
                <div className="list-foot">
                  <button className="btn btn-small" onClick={actions.showMoreDuplicates}>
                    Show more duplicates
                  </button>
                </div>
              )}
            </>
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
