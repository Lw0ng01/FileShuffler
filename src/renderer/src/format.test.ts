import { describe, expect, it } from 'vitest'
import { formatClock } from './format'

describe('formatClock', () => {
  it('shows minutes and seconds for anything under an hour', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(9)).toBe('0:09')
    expect(formatClock(75)).toBe('1:15')
    expect(formatClock(599)).toBe('9:59')
  })

  it('adds hours only once there are any', () => {
    expect(formatClock(3599)).toBe('59:59')
    expect(formatClock(3600)).toBe('1:00:00')
    expect(formatClock(3661)).toBe('1:01:01')
  })

  it('rounds down, so the clock never shows a second the video has not reached', () => {
    expect(formatClock(1.9)).toBe('0:01')
    expect(formatClock(59.99)).toBe('0:59')
  })

  it('reads an unknown length as zero rather than NaN', () => {
    // `duration` is NaN before a file is read and Infinity for a stream; neither should reach the
    // screen as text.
    expect(formatClock(Number.NaN)).toBe('0:00')
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00')
    expect(formatClock(-5)).toBe('0:00')
  })
})
