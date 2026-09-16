import { useState } from 'react'
import type { ShufflerView } from '../../../shared/shuffler'
import { useNow } from '../hooks/useNow'
import { useShortcuts } from '../hooks/useShortcuts'
import type { ShufflerActions } from '../hooks/useShuffler'
import { BackIcon, FolderIcon, NextIcon, PlayIcon, TrashIcon } from './Icons'

interface Props {
  view: ShufflerView
  actions: ShufflerActions
  actionError: string | null
  /** Short confirmation of what an action did, for example an Undo. Clears itself. */
  actionNotice: string | null
}

const isMac = navigator.userAgent.includes('Mac')

/** Shows the last two parts of a long path; the full path stays in the tooltip. */
function shortenPath(path: string): string {
  const separator = path.includes('\\') ? '\\' : '/'
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.length <= 3 ? path : `…${separator}${parts.slice(-2).join(separator)}`
}

export function ShufflerScreen({
  view,
  actions,
  actionError,
  actionNotice
}: Props): React.JSX.Element {
  useShortcuts(view, actions)
  const hasSession = view.status !== 'no-folder'
  const hasVideos = view.total > 0
  // Before the shuffle starts (or after it finishes) the card's own button is the one action, so
  // Back/Next/Delete only appear once something has played.
  const showControls =
    hasVideos &&
    (view.status === 'loading' || view.status === 'playing' || view.status === 'player-exited')
  const deletePending = view.pendingDeletes.length > 0
  // "Player exited" is expected when the user closes the mpv window; the card explains it instead.
  const error =
    actionError ??
    (view.status === 'player-exited' && view.lastError?.startsWith('Player exited')
      ? null
      : view.lastError)

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Shuffle</h1>
        {view.folder !== null && (
          <div className="folder">
            <FolderIcon size={16} />
            <span className="folder-path" title={view.folder}>
              {shortenPath(view.folder)}
            </span>
            <button
              className="btn btn-small"
              onClick={actions.chooseFolder}
              disabled={deletePending}
              title={deletePending ? 'Undo or wait for the pending delete first' : undefined}
            >
              Change
            </button>
          </div>
        )}
      </header>

      {error !== null && (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      )}

      {actionNotice !== null && (
        <div className="banner banner-notice" role="status">
          {actionNotice}
        </div>
      )}

      <StatusCard view={view} actions={actions} />

      {showControls && (
        <div className="controls">
          <button
            className="btn btn-large"
            onClick={actions.back}
            disabled={view.current === null || view.status === 'starting-player'}
          >
            <BackIcon />
            Back
          </button>
          <button
            className="btn btn-large btn-primary"
            onClick={actions.next}
            disabled={view.status === 'starting-player'}
          >
            Next
            <NextIcon />
          </button>
          <button
            className="btn btn-large btn-danger"
            onClick={actions.deleteCurrent}
            disabled={view.current === null || view.status === 'starting-player'}
          >
            <TrashIcon />
            Delete
          </button>
        </div>
      )}

      {hasSession && hasVideos && <KeyHints view={view} />}

      {view.recent.filter((id) => id !== view.current).length > 0 && (
        <section className="recent" aria-label="Recently played">
          <h2 className="section-title">Recently played</h2>
          <ul>
            {view.recent
              .filter((id) => id !== view.current)
              .map((id) => (
                <li key={id} title={id}>
                  {id}
                </li>
              ))}
          </ul>
        </section>
      )}

      <UndoToasts view={view} onUndo={actions.undoDelete} />
    </div>
  )
}

function StatusCard({
  view,
  actions
}: Omit<Props, 'actionError' | 'actionNotice'>): React.JSX.Element {
  switch (view.status) {
    case 'no-folder':
      return (
        <div className="card empty">
          <div className="empty-icon">
            <FolderIcon size={28} />
          </div>
          <h2>Pick a folder of videos</h2>
          <p className="muted">
            Plays the videos directly inside it in a shuffled order. Every video plays once before
            any repeats. Subfolders are left alone.
          </p>
          <button className="btn btn-large btn-primary" onClick={actions.chooseFolder}>
            <FolderIcon />
            Choose folder
          </button>
        </div>
      )
    case 'ready':
      if (view.total === 0) {
        return (
          <div className="card empty">
            <h2>No videos in this folder</h2>
            <p className="muted">
              Looks for mp4, mkv, webm, mov, avi, wmv and similar files directly inside the folder.
            </p>
            <button className="btn btn-large" onClick={actions.chooseFolder}>
              Choose another folder
            </button>
          </div>
        )
      }
      return (
        <div className="card">
          <p className="eyebrow">Ready</p>
          <p className="now-title">
            {view.total} {view.total === 1 ? 'video' : 'videos'}
          </p>
          <p className="muted">Each one plays once before any repeats.</p>
          <button className="btn btn-large btn-primary start" onClick={actions.play}>
            <PlayIcon />
            Start shuffle
          </button>
        </div>
      )
    case 'starting-player':
      return (
        <div className="card">
          <p className="eyebrow">Opening player</p>
          <p className="now-title muted">Starting mpv…</p>
        </div>
      )
    case 'loading':
    case 'playing':
      return (
        <div className="card" aria-live="polite">
          <p className="eyebrow">
            <span className={`dot ${view.status}`} />
            {view.status === 'loading' ? 'Opening' : 'Now playing'}
          </p>
          <p className="now-title">{view.current}</p>
          <Progress view={view} onRestartCycle={actions.restartCycle} />
        </div>
      )
    case 'finished':
      return (
        <div className="card">
          <p className="eyebrow">Stopped</p>
          <p className="now-title">Nothing left to play</p>
          <p className="muted">
            {view.failed > 0
              ? `${view.failed} ${view.failed === 1 ? "video couldn't" : "videos couldn't"} be played.`
              : 'Every video was deleted or skipped.'}
          </p>
          <button className="btn btn-large start" onClick={actions.play}>
            Try again
          </button>
        </div>
      )
    case 'player-exited':
      return (
        <div className="card">
          <p className="eyebrow">Player closed</p>
          <p className="now-title">{view.current ?? 'The player window was closed'}</p>
          <p className="muted">Reopen it to carry on from here.</p>
          <button className="btn btn-large btn-primary start" onClick={actions.play}>
            <PlayIcon />
            Reopen player
          </button>
          <Progress view={view} onRestartCycle={actions.restartCycle} />
        </div>
      )
  }
}

function Progress({
  view,
  onRestartCycle
}: {
  view: ShufflerView
  onRestartCycle: () => void
}): React.JSX.Element {
  const percent = view.total === 0 ? 0 : Math.min(100, (view.opened / view.total) * 100)
  // Restarting throws away this cycle's progress, so it asks first rather than acting on one click.
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="progress">
      <div
        className="progress-bar"
        role="progressbar"
        aria-label="Videos opened this cycle"
        aria-valuemin={0}
        aria-valuemax={view.total}
        aria-valuenow={view.opened}
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="progress-text">
        <span>
          Cycle {view.cycle} · {view.opened} of {view.total} opened
        </span>
        {view.failed > 0 && <span className="warning-text">{view.failed} skipped</span>}
        {confirming ? (
          <span className="restart">
            <span className="muted">Start over, losing this cycle&rsquo;s progress?</span>
            <button
              className="btn btn-small"
              onClick={() => {
                setConfirming(false)
                onRestartCycle()
              }}
            >
              Restart
            </button>
            <button className="btn btn-small" onClick={() => setConfirming(false)}>
              Keep going
            </button>
          </span>
        ) : (
          <button
            className="btn btn-small"
            onClick={() => setConfirming(true)}
            title="Reshuffle every video and start a new cycle"
          >
            Restart cycle
          </button>
        )}
      </div>
    </div>
  )
}

function KeyHints({ view }: { view: ShufflerView }): React.JSX.Element {
  const modifier = isMac ? '⌘' : 'Ctrl+'
  return (
    <div className="hints">
      <span>
        In mpv: <kbd>{view.playerKeys.next}</kbd> next <kbd>{view.playerKeys.back}</kbd> back{' '}
        <kbd>{view.playerKeys.delete}</kbd> delete
      </span>
      <span>
        Here: <kbd>→</kbd> next <kbd>←</kbd> back <kbd>Del</kbd> delete <kbd>{modifier}Z</kbd> undo
      </span>
    </div>
  )
}

function UndoToasts({
  view,
  onUndo
}: {
  view: ShufflerView
  onUndo: (id: string) => void
}): React.JSX.Element | null {
  const now = useNow(view.pendingDeletes.length > 0)
  if (view.pendingDeletes.length === 0) return null

  return (
    <div className="toasts" role="status" aria-live="polite">
      {view.pendingDeletes.map((entry) => {
        const seconds = Math.max(0, Math.ceil((entry.deadline - now) / 1000))
        return (
          <div className="toast" key={entry.id}>
            <TrashIcon />
            <div className="toast-text">
              <div className="toast-name" title={entry.id}>
                {entry.id}
              </div>
              <div className="toast-sub">
                {seconds > 0 ? `Moves to the trash in ${seconds}s` : 'Moving to the trash…'}
              </div>
            </div>
            <button
              className="btn btn-small"
              onClick={() => onUndo(entry.id)}
              disabled={seconds === 0}
            >
              Undo
            </button>
          </div>
        )
      })}
    </div>
  )
}
