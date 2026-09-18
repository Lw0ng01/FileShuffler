import { useEffect, useRef } from 'react'
import { videoUrl } from '../../../shared/player'

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

  useEffect(() => {
    const video = videoRef.current
    if (video === null) return

    const api = window.api.player

    const stopCommands = api.onCommand((command) => {
      if (command.type === 'load') {
        tokenRef.current = command.token
        video.src = videoUrl(command.token)
        // Autoplay is the point of a shuffle: a file that opens and waits is not what was asked
        // for. The element is muted-free and the window is focused by the time this runs, so the
        // gesture requirement does not apply - but a rejection still has to be reported rather
        // than swallowed, or the coordinator would wait forever for a `loaded` that never comes.
        void video.play().catch((error: unknown) => {
          api.send({
            type: 'failed',
            token: command.token,
            reason: error instanceof Error ? error.message : String(error)
          })
        })
        return
      }

      // Release the file. The delete flow waits for this, so it is answered whether or not
      // anything was playing (PROJECT.md §2).
      tokenRef.current = null
      video.pause()
      video.removeAttribute('src')
      video.load()
      api.send({ type: 'unloaded', requestId: command.requestId })
    })

    const onPlaying = (): void => {
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

    video.addEventListener('playing', onPlaying)
    video.addEventListener('ended', onEnded)
    video.addEventListener('error', onError)
    api.ready()

    return () => {
      stopCommands()
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('error', onError)
    }
  }, [])

  return (
    <div className={`video-stage${visible ? '' : ' is-hidden'}`}>
      {/* No `controls`: the app's own buttons drive this, and the browser's bar would be the one
          piece of chrome that ignores every token in the design. */}
      <video ref={videoRef} className="video-stage-el" playsInline />
    </div>
  )
}
