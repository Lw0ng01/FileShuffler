import { useEffect, useRef, useState, type RefObject } from 'react'
import { formatClock } from '../format'
import {
  BackIcon,
  ExitFullscreenIcon,
  FullscreenIcon,
  MuteIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  VolumeIcon
} from './Icons'

/**
 * The built-in player's controls (PROJECT.md §4).
 *
 * The whole reason for playing in the app rather than in mpv: these are ordinary elements styled
 * with the app's own tokens, so the progress bar, the volume and play/pause look like the rest of
 * FileShuffler instead of like someone else's player *(Lucas, 2026-09-17: mpv's controls were the
 * problem, not mpv)*.
 *
 * It reads the `<video>` element directly rather than mirroring its state into React. A media
 * element is the source of truth for its own position, and keeping a copy in sync with `timeupdate`
 * is how players end up with a scrubber that disagrees with the picture.
 */

export interface PlayerControlsProps {
  /**
   * The elements themselves, as refs rather than values. A media element is changed by setting its
   * properties - `currentTime`, `volume`, `muted` - and a ref is the honest way to hold something
   * that is meant to be mutated.
   */
  videoRef: RefObject<HTMLVideoElement | null>
  /** The element that goes fullscreen: the stage, so the controls come with it. */
  stageRef: RefObject<HTMLElement | null>
  /** Flips once there is a file in the element, which is when there is state worth reading. */
  ready: boolean
  onNext: () => void
  onBack: () => void
  /** False while a delete is pending, matching the rest of the Shuffle screen. */
  canMove: boolean
}

export function PlayerControls({
  videoRef,
  stageRef,
  ready,
  onNext,
  onBack,
  canMove
}: PlayerControlsProps): React.JSX.Element {
  const [paused, setPaused] = useState(true)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  // While dragging the scrubber the pointer decides where we are, not the element - otherwise every
  // `timeupdate` would yank the handle back under your finger.
  const scrubbing = useRef(false)

  useEffect(() => {
    const video = videoRef.current
    if (video === null) return

    const sync = (): void => {
      setPaused(video.paused)
      setVolume(video.volume)
      setMuted(video.muted)
      if (Number.isFinite(video.duration)) setDuration(video.duration)
      if (!scrubbing.current) setTime(video.currentTime)
    }

    sync()
    const events = ['play', 'pause', 'timeupdate', 'durationchange', 'volumechange', 'loadeddata']
    for (const name of events) video.addEventListener(name, sync)
    return () => {
      for (const name of events) video.removeEventListener(name, sync)
    }
  }, [videoRef, ready])

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const seekTo = (value: number): void => {
    const video = videoRef.current
    if (video === null) return
    video.currentTime = value
    setTime(value)
  }

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement !== null) {
      void document.exitFullscreen()
      return
    }
    // The stage rather than the video, so these controls are inside the fullscreen element and
    // still reachable. Going fullscreen on the `<video>` itself would hand the browser's own
    // controls back, which is the look this exists to replace.
    void stageRef.current?.requestFullscreen()
  }

  const togglePlay = (): void => {
    const video = videoRef.current
    if (video === null) return
    if (video.paused) void video.play().catch(() => undefined)
    else video.pause()
  }

  const setMutedTo = (value: boolean): void => {
    const video = videoRef.current
    if (video !== null) video.muted = value
  }

  const setVolumeTo = (value: number): void => {
    const video = videoRef.current
    if (video === null) return
    video.volume = value
    // Moving the slider at all is a clear enough sign that silence was not the intent.
    video.muted = false
  }

  // `duration` is Infinity or 0 until the file is read, and a scrubber that cannot be positioned
  // should not pretend otherwise.
  const seekable = duration > 0 && Number.isFinite(duration)

  return (
    <div className="player-bar">
      <input
        className="player-seek"
        type="range"
        min={0}
        max={seekable ? duration : 0}
        step="any"
        value={seekable ? Math.min(time, duration) : 0}
        disabled={!seekable}
        aria-label="Position"
        // The filled part is drawn from this, so the bar shows progress rather than being a plain
        // track with a handle on it.
        style={{ ['--played' as string]: `${seekable ? (time / duration) * 100 : 0}%` }}
        onPointerDown={() => (scrubbing.current = true)}
        onPointerUp={() => (scrubbing.current = false)}
        onChange={(event) => seekTo(Number(event.currentTarget.value))}
      />

      <div className="player-row">
        <button className="player-btn" onClick={togglePlay} aria-label={paused ? 'Play' : 'Pause'}>
          {paused ? <PlayIcon size={20} /> : <PauseIcon size={20} />}
        </button>
        <button
          className="player-btn"
          onClick={onBack}
          disabled={!canMove}
          aria-label="Previous video"
        >
          <BackIcon size={20} />
        </button>
        <button className="player-btn" onClick={onNext} disabled={!canMove} aria-label="Next video">
          <NextIcon size={20} />
        </button>

        <span className="player-time">
          {formatClock(time)}{' '}
          <span className="faint">/ {seekable ? formatClock(duration) : '--:--'}</span>
        </span>

        <div className="player-volume">
          <button
            className="player-btn"
            onClick={() => setMutedTo(!muted)}
            aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}
          >
            {muted || volume === 0 ? <MuteIcon size={18} /> : <VolumeIcon size={18} />}
          </button>
          <input
            className="player-level"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            aria-label="Volume"
            style={{ ['--played' as string]: `${(muted ? 0 : volume) * 100}%` }}
            onChange={(event) => setVolumeTo(Number(event.currentTarget.value))}
          />
        </div>

        <button
          className="player-btn"
          onClick={toggleFullscreen}
          aria-label={fullscreen ? 'Leave fullscreen' : 'Fullscreen'}
        >
          {fullscreen ? <ExitFullscreenIcon size={18} /> : <FullscreenIcon size={18} />}
        </button>
      </div>
    </div>
  )
}
