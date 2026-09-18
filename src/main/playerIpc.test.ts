import { describe, expect, it } from 'vitest'
import { asEventMessage } from './playerIpc'

describe('asEventMessage', () => {
  it('accepts the messages the renderer is allowed to send', () => {
    expect(asEventMessage({ type: 'loaded', token: 3 })).toEqual({ type: 'loaded', token: 3 })
    expect(asEventMessage({ type: 'ended', token: 3 })).toEqual({ type: 'ended', token: 3 })
    expect(asEventMessage({ type: 'unloaded', requestId: 7 })).toEqual({
      type: 'unloaded',
      requestId: 7
    })
    expect(asEventMessage({ type: 'failed', token: 1, reason: 'DEMUXER_ERROR', code: 4 })).toEqual({
      type: 'failed',
      token: 1,
      reason: 'DEMUXER_ERROR',
      code: 4
    })
  })

  it('drops anything malformed rather than guessing', () => {
    expect(asEventMessage(null)).toBeNull()
    expect(asEventMessage('ended')).toBeNull()
    expect(asEventMessage({})).toBeNull()
    expect(asEventMessage({ type: 'ended' })).toBeNull()
    expect(asEventMessage({ type: 'ended', token: '3' })).toBeNull()
    expect(asEventMessage({ type: 'ended', token: 0 })).toBeNull()
    expect(asEventMessage({ type: 'ended', token: -1 })).toBeNull()
    expect(asEventMessage({ type: 'ended', token: 1.5 })).toBeNull()
    expect(asEventMessage({ type: 'failed', token: 1 })).toBeNull()
    // The code decides whether the file goes to the system player, so it has to be there.
    expect(asEventMessage({ type: 'failed', token: 1, reason: 'x' })).toBeNull()
    expect(asEventMessage({ type: 'failed', token: 1, reason: 'x', code: '4' })).toBeNull()
    expect(asEventMessage({ type: 'nonsense', token: 1 })).toBeNull()
  })

  it('caps a failure reason, which is the only free text the page can send', () => {
    const message = asEventMessage({
      type: 'failed',
      token: 1,
      reason: 'x'.repeat(5000),
      code: 4
    })

    expect(message).not.toBeNull()
    expect((message as { reason: string }).reason.length).toBe(200)
  })
})
