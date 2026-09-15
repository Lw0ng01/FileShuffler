import { describe, expect, it, vi } from 'vitest'
import type { PlaybackEvent } from '../types'
import { MpvIpcClient } from './ipcClient'
import { KEY_BINDINGS, MpvPlayer, mpvArguments, type MpvRuntime } from './mpvPlayer'
import { FakeMpv, flush } from './testing'

function setup(): {
  mpv: FakeMpv
  player: MpvPlayer
  events: PlaybackEvent[]
  runtime: MpvRuntime
  exit: (reason: string) => void
} {
  const mpv = new FakeMpv()
  let entry = 0
  mpv.respond = (command) => (command[0] === 'loadfile' ? { playlist_entry_id: ++entry } : null)

  let exit: (reason: string) => void = () => {}
  const exited = new Promise<string>((resolve) => {
    exit = resolve
  })
  const runtime: MpvRuntime = {
    exited,
    kill: vi.fn(() => exit('killed by SIGTERM')),
    cleanup: vi.fn(async () => {})
  }
  const player = new MpvPlayer(new MpvIpcClient(mpv.socket), runtime, {
    pollIntervalMs: 1,
    unloadTimeoutMs: 100,
    quitTimeoutMs: 30
  })
  const events: PlaybackEvent[] = []
  player.onEvent((event) => events.push(event))
  return { mpv, player, events, runtime, exit }
}

describe('mpvArguments', () => {
  it('keeps the required arguments after any extra ones so they always win', () => {
    const args = mpvArguments('/tmp/ipc.sock', '/tmp/input.conf', ['--idle=no', '--vo=null'])
    expect(args.slice(0, 2)).toEqual(['--idle=no', '--vo=null'])
    expect(args.slice(2)).toEqual(
      expect.arrayContaining([
        '--no-config',
        '--idle=yes',
        '--ytdl=no',
        '--input-conf=/tmp/input.conf',
        '--input-ipc-server=/tmp/ipc.sock'
      ])
    )
    expect(args.lastIndexOf('--idle=yes')).toBeGreaterThan(args.indexOf('--idle=no'))
  })

  it('binds only the next and back messages', () => {
    expect(KEY_BINDINGS).toBe(
      '> script-message fileshuffler next\n< script-message fileshuffler back\n'
    )
  })
})

describe('MpvPlayer', () => {
  it('replaces the current file and reports loaded, then ended, for that load', async () => {
    const { mpv, player, events } = setup()
    const token = player.load('/videos/a.mkv')
    await flush()
    expect(mpv.commands).toEqual([['loadfile', '/videos/a.mkv', 'replace']])

    mpv.send({ event: 'start-file', playlist_entry_id: 1 })
    mpv.send({ event: 'file-loaded' })
    mpv.send({ event: 'end-file', reason: 'eof', playlist_entry_id: 1 })
    await flush()

    expect(events).toEqual([
      { type: 'loaded', token },
      { type: 'ended', token }
    ])
  })

  it('reports a file mpv cannot open as failed, with mpv’s reason', async () => {
    const { mpv, player, events } = setup()
    const token = player.load('/videos/missing.mkv')
    await flush()
    mpv.send({ event: 'start-file', playlist_entry_id: 1 })
    mpv.send({
      event: 'end-file',
      reason: 'error',
      playlist_entry_id: 1,
      file_error: 'loading failed'
    })
    await flush()

    expect(events).toEqual([{ type: 'failed', token, reason: 'loading failed' }])
  })

  it('stays quiet about a file that was replaced by a newer load', async () => {
    const { mpv, player, events } = setup()
    player.load('/videos/a.mkv')
    const second = player.load('/videos/b.mkv')
    await flush()

    mpv.send({ event: 'start-file', playlist_entry_id: 1 })
    mpv.send({ event: 'end-file', reason: 'stop', playlist_entry_id: 1 })
    mpv.send({ event: 'start-file', playlist_entry_id: 2 })
    mpv.send({ event: 'file-loaded' })
    await flush()

    expect(events).toEqual([{ type: 'loaded', token: second }])
  })

  it('still reports events that arrive before the loadfile reply', async () => {
    const { mpv, player, events } = setup()
    mpv.holdReplies = true
    const token = player.load('/videos/a.mkv')
    await flush()

    mpv.send({ event: 'start-file', playlist_entry_id: 1 })
    mpv.send({ event: 'file-loaded' })
    mpv.send({ event: 'end-file', reason: 'eof', playlist_entry_id: 1 })
    await flush()
    expect(events).toEqual([])

    mpv.releaseReplies()
    await flush()
    expect(events).toEqual([
      { type: 'loaded', token },
      { type: 'ended', token }
    ])
  })

  it('reports a rejected loadfile command as a failed load', async () => {
    const { mpv, player, events } = setup()
    mpv.respond = () => {
      throw new Error('invalid parameter')
    }
    const token = player.load('/videos/a.mkv')
    await flush()
    expect(events).toEqual([
      { type: 'failed', token, reason: 'mpv command failed: invalid parameter' }
    ])
  })

  it('turns key-binding messages into next and back commands', async () => {
    const { mpv, events } = setup()
    mpv.send({ event: 'client-message', args: ['fileshuffler', 'next'] })
    mpv.send({ event: 'client-message', args: ['fileshuffler', 'back'] })
    mpv.send({ event: 'client-message', args: ['other-script', 'next'] })
    mpv.send({ event: 'client-message', args: ['fileshuffler', 'delete'] })
    await flush()

    expect(events).toEqual([
      { type: 'command', command: 'next' },
      { type: 'command', command: 'back' }
    ])
  })

  it('unloads by stopping and waiting until mpv reports it is idle', async () => {
    const { mpv, player } = setup()
    let idleChecks = 0
    mpv.respond = (command) => (command[0] === 'get_property' ? ++idleChecks >= 3 : null)

    await player.unload()
    expect(mpv.commands).toEqual([
      ['stop'],
      ['get_property', 'idle-active'],
      ['get_property', 'idle-active'],
      ['get_property', 'idle-active']
    ])
  })

  it('fails the unload if mpv never becomes idle', async () => {
    const { mpv, player } = setup()
    mpv.respond = (command) => (command[0] === 'get_property' ? false : null)
    await expect(player.unload()).rejects.toThrow('Timed out waiting for mpv to release the file')
  })

  it('reports exit once, then fails later loads without contacting mpv', async () => {
    const { mpv, player, events, exit } = setup()
    mpv.close()
    await flush()
    // The process exit that follows a closed connection must not produce a second event.
    exit('code 0')
    await flush()
    expect(events).toEqual([{ type: 'exited', reason: 'mpv closed the IPC connection' }])

    const token = player.load('/videos/a.mkv')
    await flush()
    expect(events[1]).toEqual({ type: 'failed', token, reason: 'mpv is not running' })
    expect(mpv.commands).toEqual([])
    await expect(player.unload()).resolves.toBeUndefined()
  })

  it('disposes by quitting, force-stopping an mpv that hangs, and cleaning up once', async () => {
    const { mpv, player, events, runtime } = setup()
    const first = player.dispose()
    const second = player.dispose()
    expect(second).toBe(first)
    await first

    expect(mpv.commands).toEqual([['quit']])
    expect(runtime.kill).toHaveBeenCalledTimes(1)
    expect(runtime.cleanup).toHaveBeenCalledTimes(1)
    expect(events.filter((event) => event.type === 'exited')).toHaveLength(1)
  })
})
