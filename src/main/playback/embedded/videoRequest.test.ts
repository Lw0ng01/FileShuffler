import { describe, expect, it } from 'vitest'
import { contentType, parseRange, tokenFromUrl } from './videoRequest'

describe('tokenFromUrl', () => {
  it('reads the token out of a video URL', () => {
    expect(tokenFromUrl('fsvideo://file/1')).toBe(1)
    expect(tokenFromUrl('fsvideo://file/42')).toBe(42)
  })

  it('refuses anything that is not a plain positive token', () => {
    // A path here would be the whole point of the scheme defeated.
    expect(tokenFromUrl('fsvideo://file/../../etc/passwd')).toBeNull()
    expect(tokenFromUrl('fsvideo://file/C:/videos/a.mp4')).toBeNull()
    expect(tokenFromUrl('fsvideo://file/')).toBeNull()
    expect(tokenFromUrl('fsvideo://file/0')).toBeNull()
    expect(tokenFromUrl('fsvideo://file/-1')).toBeNull()
    expect(tokenFromUrl('fsvideo://file/1.5')).toBeNull()
    expect(tokenFromUrl('not a url')).toBeNull()
  })
})

describe('parseRange', () => {
  it('treats a missing or unreadable range as the whole file', () => {
    expect(parseRange(null, 100)).toBeNull()
    expect(parseRange('', 100)).toBeNull()
    expect(parseRange('bytes=-', 100)).toBeNull()
    expect(parseRange('pages=1-2', 100)).toBeNull()
  })

  it('reads a normal range', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 })
  })

  it('reads an open-ended range as running to the last byte', () => {
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
  })

  it('clamps an end past the last byte instead of failing', () => {
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 })
  })

  it('reads a suffix range as the last N bytes', () => {
    expect(parseRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 })
    // Asking for more than there is gives the whole file, not a negative start.
    expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 })
  })

  it('calls a range outside the file unsatisfiable, which has its own answer', () => {
    // A player seeking to the very end asks for this, so it must not read as a broken request.
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable')
    expect(parseRange('bytes=1200-1300', 1000)).toBe('unsatisfiable')
    expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable')
  })

  it('handles an empty file without producing a negative range', () => {
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable')
    expect(parseRange('bytes=-10', 0)).toBe('unsatisfiable')
  })
})

describe('contentType', () => {
  it('serves QuickTime containers as mp4, because that is what plays', () => {
    expect(contentType('C:/videos/a.mov')).toBe('video/mp4')
    expect(contentType('C:/videos/a.m4v')).toBe('video/mp4')
    expect(contentType('C:/videos/a.mp4')).toBe('video/mp4')
  })

  it('names the formats with a type of their own', () => {
    expect(contentType('C:/videos/a.webm')).toBe('video/webm')
    expect(contentType('C:/videos/A.WEBM')).toBe('video/webm')
  })
})
