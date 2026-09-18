import { useEffect, useRef, useState } from 'react'
import { videoUrl } from '../../../shared/player'

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
export function VideoStage({ visible }: { visible: boolean }): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  // The load a report belongs to. Kept in a ref because events arrive outside React's flow, and a
  // stale token must never be reported as the current one.
  const tokenRef = useRef<number | null>(null)
  // Whether there is actually a file in the element. Without this the surface showed as an empty
  // black box whenever the Shuffle tab was open, including before anything had ever played
  // (Lucas, 2026-09-17). It is never a placeholder: no video, nothing on screen.
  const [hasVideo, setHasVideo] = useState(false)

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

    video.addEventListener('loadeddata', onLoadedData)
    video.addEventListener('ended', onEnded)
    video.addEventListener('error', onError)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    api.ready()

    return () => {
      stopCommands()
      video.removeEventListener('loadeddata', onLoadedData)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('error', onError)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  return (
    <div className={`video-stage${visible && hasVideo ? '' : ' is-hidden'}`}>
      {/* No `controls`: the app's own buttons drive this, and the browser's bar would be the one
          piece of chrome that ignores every token in the design. */}
      <video ref={videoRef} className="video-stage-el" playsInline />
    </div>
  )
}
