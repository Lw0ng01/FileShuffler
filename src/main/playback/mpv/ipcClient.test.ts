import { describe, expect, it } from 'vitest'
import { MpvIpcClient, type MpvEvent } from './ipcClient'
import { FakeMpv, flush } from './testing'

describe('MpvIpcClient', () => {
  it('sends one JSON message per line with increasing request IDs', async () => {
    const mpv = new FakeMpv()
    const client = new MpvIpcClient(mpv.socket)
    await Promise.all([client.command(['stop']), client.command(['loadfile', 'a\nb.mkv'])])

    expect(mpv.requests).toEqual([
      { requestId: 1, command: ['stop'] },
      { requestId: 2, command: ['loadfile', 'a\nb.mkv'] }
    ])
  })

  it('matches replies to requests even when they arrive out of order and split across chunks', async () => {
    const mpv = new FakeMpv()
    mpv.holdReplies = true
    const client = new MpvIpcClient(mpv.socket)
    const first = client.command(['get_property', 'path'])
    const second = client.command(['get_property', 'pause'])
    await flush()

    mpv.sendRaw('{"request_id":2,"error":"success","data":false}\n{"request_id":1,"err')
    mpv.sendRaw('or":"success","data":"/videos/ü.mkv"}\n')

    await expect(first).resolves.toBe('/videos/ü.mkv')
    await expect(second).resolves.toBe(false)
  })

  it('rejects a command when mpv reports an error', async () => {
    const mpv = new FakeMpv()
    mpv.respond = () => {
      throw new Error('invalid parameter')
    }
    const client = new MpvIpcClient(mpv.socket)
    await expect(client.command(['loadfile'])).rejects.toThrow(
      'mpv command failed: invalid parameter'
    )
  })

  it('delivers events and skips lines that are not valid JSON', async () => {
    const mpv = new FakeMpv()
    const client = new MpvIpcClient(mpv.socket)
    const events: MpvEvent[] = []
    client.onEvent((event) => events.push(event))

    mpv.sendRaw('not json\n\n{"event":"idle"}\n')
    mpv.send({ event: 'end-file', reason: 'eof', playlist_entry_id: 3 })
    await flush()

    expect(events).toEqual([
      { event: 'idle' },
      { event: 'end-file', reason: 'eof', playlist_entry_id: 3 }
    ])
  })

  it('rejects pending and later commands once the connection closes', async () => {
    const mpv = new FakeMpv()
    mpv.holdReplies = true
    const client = new MpvIpcClient(mpv.socket)
    let closes = 0
    client.onClose(() => closes++)
    const pending = client.command(['get_property', 'idle-active'])
    await flush()

    mpv.close()
    await expect(pending).rejects.toThrow('mpv IPC connection closed')
    await expect(client.command(['stop'])).rejects.toThrow('mpv IPC connection is closed')
    expect(closes).toBe(1)
  })
})
