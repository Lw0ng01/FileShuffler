import type { LibrarySort } from '../../../shared/library'
import type { StatsView } from '../../../shared/stats'
import { formatBytes, formatCount, formatWhen, shortenPath } from '../format'
import type { LibraryActions } from '../hooks/useLibrary'
import type { NeverPlayedList, StatsActions } from '../hooks/useStats'

const NEVER_PLAYED_SORTS: { sort: LibrarySort; label: string }[] = [
  { sort: 'modified', label: 'Newest first' },
  { sort: 'size', label: 'Largest first' },
  { sort: 'name', label: 'A to Z' }
]

interface Props {
  view: StatsView | null
  favorites: ReadonlySet<string>
  neverPlayed: NeverPlayedList
  error: string | null
  actions: StatsActions
  /** Open and Show come from the library, which checks the path is one the app knows. */
  fileActions: Pick<LibraryActions, 'openFile' | 'showInFolder'>
}

interface RowProps {
  path: string
  name: string
  folder: string
  detail: string
  favorites: ReadonlySet<string>
  actions: StatsActions
  fileActions: Props['fileActions']
}

export function StatsScreen({
  view,
  favorites,
  neverPlayed,
  error,
  actions,
  fileActions
}: Props): React.JSX.Element {
  if (view === null) return <p className="loading">Loading…</p>

  const shown = error ?? view.lastError
  const { totals } = view
  const row = { favorites, actions, fileActions }

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Stats</h1>
      </header>

      {shown !== null && (
        <div className="banner banner-error" role="alert">
          {shown}
        </div>
      )}

      <div className="card">
        <p className="eyebrow">Play history</p>
        {totals.plays === 0 ? (
          <>
            <p className="now-title">Nothing played yet</p>
            <p className="muted">
              Plays are recorded as the shuffler opens videos, and marked finished when one plays to
              the end. It all stays on this computer.
            </p>
          </>
        ) : (
          <>
            <p className="now-title">
              {formatCount(totals.plays, 'play')}{' '}
              <span className="muted">· {formatCount(totals.files)}</span>
            </p>
            <p className="muted">
              {totals.finished.toLocaleString()} played to the end,{' '}
              {(totals.plays - totals.finished).toLocaleString()} skipped · since{' '}
              {formatWhen(totals.since)}
            </p>
          </>
        )}
      </div>

      <section className="dash-section" aria-label="Favorites">
        <h2 className="section-title">Favorites</h2>
        {view.favorites.length === 0 ? (
          <p className="muted">Star a file in any list below to keep it here.</p>
        ) : (
          <ul className="files">
            {view.favorites.map((favorite) => (
              <StatRow
                key={favorite.path}
                path={favorite.path}
                name={favorite.name}
                folder={favorite.folder}
                detail={`starred ${formatWhen(favorite.addedAt)}`}
                {...row}
              />
            ))}
          </ul>
        )}
      </section>

      <div className="two-col">
        <section className="dash-section" aria-label="Most played">
          <h2 className="section-title">Most played</h2>
          {view.mostPlayed.length === 0 ? (
            <p className="muted">Nothing yet.</p>
          ) : (
            <ul className="files">
              {view.mostPlayed.map((played) => (
                <StatRow
                  key={played.path}
                  path={played.path}
                  name={played.name}
                  folder={played.folder}
                  detail={`${formatCount(played.plays, 'play')} · ${played.finished} finished`}
                  {...row}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="dash-section" aria-label="Recently played">
          <h2 className="section-title">Recently played</h2>
          {view.recentlyPlayed.length === 0 ? (
            <p className="muted">Nothing yet.</p>
          ) : (
            <ul className="files">
              {view.recentlyPlayed.map((played) => (
                <StatRow
                  key={played.path}
                  path={played.path}
                  name={played.name}
                  folder={played.folder}
                  detail={formatWhen(played.lastPlayedAt)}
                  {...row}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="dash-section" aria-label="Never played">
        <div className="section-head">
          <h2 className="section-title">Never played</h2>
          <select
            className="select"
            aria-label="Sort never played"
            value={neverPlayed.sort}
            onChange={(event) => actions.setNeverPlayedSort(event.target.value as LibrarySort)}
          >
            {NEVER_PLAYED_SORTS.map((option) => (
              <option key={option.sort} value={option.sort}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {neverPlayed.rows.length === 0 ? (
          <p className="muted">
            Every indexed video has played at least once, or nothing is indexed yet.
          </p>
        ) : (
          <>
            <ul className="files">
              {neverPlayed.rows.map((file) => (
                <StatRow
                  key={file.path}
                  path={file.path}
                  name={file.name}
                  folder={file.folder}
                  detail={formatBytes(file.size)}
                  {...row}
                />
              ))}
            </ul>
            {neverPlayed.hasMore && (
              <div className="list-foot">
                <span className="muted">Showing {neverPlayed.rows.length.toLocaleString()}</span>
                <button className="btn btn-small" onClick={actions.showMoreNeverPlayed}>
                  Show more
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function StatRow({
  path,
  name,
  folder,
  detail,
  favorites,
  actions,
  fileActions
}: RowProps): React.JSX.Element {
  const starred = favorites.has(path)
  return (
    <li className="file-row">
      <button
        className={`star${starred ? ' starred' : ''}`}
        onClick={() => actions.toggleFavorite(path)}
        aria-pressed={starred}
        aria-label={starred ? `Remove ${name} from favorites` : `Add ${name} to favorites`}
        title={starred ? 'Remove from favorites' : 'Add to favorites'}
      >
        {starred ? '★' : '☆'}
      </button>
      <span className="file-name" title={path}>
        {name}
      </span>
      <span className="muted file-folder" title={folder}>
        {shortenPath(folder)}
      </span>
      <span className="muted">{detail}</span>
      <span className="row-actions">
        <button className="btn btn-small" onClick={() => fileActions.openFile(path)}>
          Open
        </button>
        <button
          className="btn btn-small"
          onClick={() => fileActions.showInFolder(path)}
          title="Show this file in the file manager"
        >
          Show
        </button>
      </span>
    </li>
  )
}
