import { afterEach, describe, expect, it } from 'vitest'
import type { PlaybackEvent } from '../types'
import type { MpvEvent } from './ipcClient'
import { launchMpv, type MpvPlayer } from './mpvPlayer'

/**
 * Runs against a real mpv binary when MPV_PATH is set; skipped otherwise. No window, audio, media
 * files or network: mpv's built-in lavfi test source stands in for a video.
 *
 *   MPV_PATH=/path/to/mpv npx vitest run src/main/playback/mpv
 */
const mpvPath = process.env['MPV_PATH']
const testVideo = (seconds: number): string =>
  `av://lavfi:testsrc=duration=${seconds}:size=64x64:rate=10`

describe.skipIf(mpvPath === undefined)('MpvPlayer with a real mpv', { timeout: 20000 }, () => {
  const players: MpvPlayer[] = []

  afterEach(async () => {
    await Promise.all(players.splice(0).map((player) => player.dispose()))
  })

  /**
   * Every mpv message of the current test, with the milliseconds since it started.
   *
   * A timeout here used to report only the events the adapter chose to emit, which cannot tell
   * "mpv never said anything" apart from "mpv ended the file for a reason that maps to no event at
   * all" - `endOutcome` turns everything except `eof` and `error` into silence. Two attempts to
   * explain this flake were guesses for want of exactly this. Module scope is safe because vitest
   * runs the tests in a file one after another unless they are marked concurrent.
   */
  let raw: { at: number; event: MpvEvent }[] = []

  async function start(): Promise<{ player: MpvPlayer; events: PlaybackEvent[] }> {
    const player = await launchMpv({
      mpvPath: mpvPath as string,
      extraArgs: ['--vo=null', '--ao=null']
    })
    players.push(player)
    const startedAt = Date.now()
    raw = []
    // Test-only access to the IPC client, to record what mpv actually sent before the adapter
    // interpreted it.
    player['client'].onEvent((event) => raw.push({ at: Date.now() - startedAt, event }))
    const events: PlaybackEvent[] = []
    player.onEvent((event) => events.push(event))
    return { player, events }
  }

  async function waitFor(
    events: PlaybackEvent[],
    matches: (event: PlaybackEvent) => boolean,
    // Inside the 20 s budget this suite declares, which the old 8 s default undercut: a full run
    // starts several real mpv processes alongside 27 other test files, and a one-second clip can
    // take longer than that to finish under the contention.
    timeoutMs = 15000
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!events.some(matches)) {
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out after ${timeoutMs} ms.\n` +
            `Emitted: ${JSON.stringify(events)}\n` +
            `Raw mpv messages: ${JSON.stringify(raw)}`
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  it('reports a missing file as a failed load', async () => {
    const { player, events } = await start()
    const token = player.load('/nonexistent/fileshuffler/missing.mkv')
    await waitFor(events, (event) => event.type === 'failed')
    expect(events).toEqual([{ type: 'failed', token, reason: 'loading failed' }])
  })

  it('reports loaded, then ended, for a video that plays to the end', async () => {
    const { player, events } = await start()
    const token = player.load(testVideo(1))
    await waitFor(events, (event) => event.type === 'ended')
    expect(events).toEqual([
      { type: 'loaded', token },
      { type: 'ended', token }
    ])
  })

  it('only reports the newer of two back-to-back loads', async () => {
    const { player, events } = await start()
    const first = player.load(testVideo(5))
    const second = player.load(testVideo(1))
    await waitFor(events, (event) => event.type === 'ended')
    expect(events).toEqual([
      { type: 'loaded', token: second },
      { type: 'ended', token: second }
    ])
    expect(events.some((event) => 'token' in event && event.token === first)).toBe(false)
  })

  it('turns the in-player key bindings into commands', async () => {
    const { player, events } = await start()
    // Test-only access to the IPC client, to press keys the way a user would in the mpv window.
    const client = player['client']
    await client.command(['keypress', '>'])
    await client.command(['keypress', '<'])
    await client.command(['keypress', 'DEL'])
    await waitFor(events, (event) => event.type === 'command' && event.command === 'delete')
    expect(events).toEqual([
      { type: 'command', command: 'next' },
      { type: 'command', command: 'back' },
      { type: 'command', command: 'delete' }
    ])
  })

  it('unloads a playing video and returns once mpv is idle, without an ended event', async () => {
    const { player, events } = await start()
    player.load(testVideo(5))
    await waitFor(events, (event) => event.type === 'loaded')

    await player.unload()
    expect(await player['client'].command(['get_property', 'idle-active'])).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(events.map((event) => event.type)).toEqual(['loaded'])
  })

  it('reports exit when disposed', async () => {
    const { player, events } = await start()
    await player.dispose()
    expect(events.filter((event) => event.type === 'exited')).toHaveLength(1)
  })
})
