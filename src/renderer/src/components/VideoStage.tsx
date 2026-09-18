import { useEffect, useRef, useState } from 'react'
import { videoUrl } from '../../../shared/player'
import { PlayerControls } from './PlayerControls'

/**
 * Starts playback, treating a refusal as "not now" rather than as a broken file.
 *
 * Chromium rejects `play()` for its own reasons - most often because the window is in the
 * background, where it pauses video-only media to save power. The file is open and fine either way,
 * so this must not be reported as a failure: doing so had the coordinator skip the file and move
 * on, which emptied a whole cycle without playing anything.
 */
function start(video: HTMLVideoElement): void {
  void video.play().catch(() => undefined)
}

/** Fullscreen goes on the stage, not the video, so the app's own controls come with it. */
function toggleFullscreen(stage: HTMLElement | null): void {
  if (document.fullscreenElement !== null) {
    void document.exitFullscreen()
    return
  }
  void stage?.requestFullscreen()
}

const SEEK_SECONDS = 5
const VOLUME_STEP = 0.05

/**
 * The keys that work while the player has focus. Deliberately the ones people already expect from
 * every other player, and deliberately not the plain arrows and Delete that `CLAUDE.md` keeps out
 * of global shortcuts - these only apply when the video itself is focused.
 *
 * Returns whether the key was ours, so the caller knows what to swallow.
 */
function shortcut(
  event: React.KeyboardEvent,
  video: HTMLVideoElement,
  stage: HTMLElement | null,
  actions: { onNext: () => void; onBack: () => void; canMove: boolean }
): boolean {
  switch (event.key) {
    case ' ':
    case 'k':
      if (video.paused) start(video)
      else video.pause()
      return true
    case 'ArrowRight':
      video.currentTime = Math.min(video.currentTime + SEEK_SECONDS, video.duration || 0)
      return true
    case 'ArrowLeft':
      video.currentTime = Math.max(video.currentTime - SEEK_SECONDS, 0)
      return true
    case 'ArrowUp':
      video.volume = Math.min(video.volume + VOLUME_STEP, 1)
      video.muted = false
      return true
    case 'ArrowDown':
      video.volume = Math.max(video.volume - VOLUME_STEP, 0)
      return true
    case 'm':
      video.muted = !video.muted
      return true
    case 'f':
      toggleFullscreen(stage)
      return true
    case 'n':
      if (actions.canMove) actions.onNext()
      return true
    case 'b':
      if (actions.canMove) actions.onBack()
      return true
    default:
      return false
  }
}

/**
 * The built-in player's video surface (PROJECT.md §4).
 *
 * It is mounted for the whole life of the app, not just while the Shuffle tab is open, because
 * unmounting it would stop playback the moment you looked at the Dashboard. Switching tabs hides
 * it; the file keeps playing, which is what the separate mpv window used to do.
 *
 * Everything it knows about a file is a token. Main decides what that token points at, so the page
 * cannot ask for a file it was not given.
 */
export function VideoStage({
  visible,
  onNext,
  onBack,
  canMove
}: {
  visible: boolean
  onNext: () => void
  onBack: () => void
  canMove: boolean
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  // The load a report belongs to. Kept in a ref because events arrive outside React's flow, and a
  // stale token must never be reported as the current one.
  const tokenRef = useRef<number | null>(null)
  // Whether there is actually a file in the element. Without this the surface showed as an empty
  // black box whenever the Shuffle tab was open, including before anything had ever played
  // (Lucas, 2026-09-17). It is never a placeholder: no video, nothing on screen.
  const [hasVideo, setHasVideo] = useState(false)
  // Controls stay up while paused. A paused video with no visible way to start it again is the
  // one state where hiding them is actively unhelpful.
  const [paused, setPaused] = useState(true)

  useEffect(() => {
    const video = videoRef.current
    if (video === null) return

    const api = window.api.player

    const stopCommands = api.onCommand((command) => {
      if (command.type === 'load') {
        tokenRef.current = command.token
        setHasVideo(true)
        video.src = videoUrl(command.token)
        start(video)
        return
      }

      // Release the file. The delete flow waits for this, so it is answered whether or not
      // anything was playing (PROJECT.md §2).
      tokenRef.current = null
      setHasVideo(false)
      video.pause()
      video.removeAttribute('src')
      video.load()
      api.send({ type: 'unloaded', requestId: command.requestId })
    })

    // Reported when the file is open, not when it starts moving. Chromium refuses to start
    // video-only media while the window is in the background ("paused to save power"), and tying
    // this to playback meant a file that opened perfectly well was reported as broken and skipped
    // (Lucas, 2026-09-17: two files in a row failed with nothing playing). The interface says
    // `loaded` means the player opened the file, which is exactly this event.
    const onLoadedData = (): void => {
      const token = tokenRef.current
      if (token !== null) api.send({ type: 'loaded', token })
    }
    const onEnded = (): void => {
      const token = tokenRef.current
      if (token !== null) api.send({ type: 'ended', token })
    }
    const onError = (): void => {
      const token = tokenRef.current
      if (token === null) return
      api.send({
        type: 'failed',
        token,
        reason: video.error?.message ?? 'The file would not play.'
      })
    }

    // Coming back to the window is the moment a refused start can be retried, and the only way a
    // file paused in the background ever gets going again without the user pressing anything.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') start(video)
    }

    const onPlayState = (): void => setPaused(video.paused)

    video.addEventListener('play', onPlayState)
    video.addEventListener('pause', onPlayState)
    video.addEventListener('loadeddata', onLoadedData)
    video.addEventListener('ended', onEnded)
    video.addEventListener('error', onError)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    api.ready()

    return () => {
      stopCommands()
      video.removeEventListener('play', onPlayState)
      video.removeEventListener('pause', onPlayState)
      video.removeEventListener('loadeddata', onLoadedData)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('error', onError)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  return (
    <div
      ref={stageRef}
      className={`video-stage${visible && hasVideo ? '' : ' is-hidden'}${paused ? ' is-paused' : ''}`}
      // Focusable so the keyboard shortcuts have somewhere to live that is not the whole window:
      // space must not scroll the page, and must not fight with a text field on another screen.
      tabIndex={-1}
      onKeyDown={(event) => {
        const video = videoRef.current
        if (video === null) return
        const handled = shortcut(event, video, stageRef.current, { onNext, onBack, canMove })
        if (handled) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
    >
      {/* The frame is what the controls are positioned against, so they line up with the picture
          rather than with the screen gutter, and both share its rounded corners. */}
      <div className="video-frame">
        {/* No `controls`: the browser's own bar is exactly the look this replaces. */}
        <video
          ref={videoRef}
          className="video-stage-el"
          playsInline
          onClick={() => {
            const video = videoRef.current
            if (video === null) return
            if (video.paused) start(video)
            else video.pause()
          }}
          onDoubleClick={() => toggleFullscreen(stageRef.current)}
        />
        <PlayerControls
          videoRef={videoRef}
          stageRef={stageRef}
          ready={hasVideo}
          onNext={onNext}
          onBack={onBack}
          canMove={canMove}
        />
      </div>
    </div>
  )
}
