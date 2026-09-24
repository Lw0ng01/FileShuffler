import { describe, expect, it } from 'vitest'
import { findMpv, locateMpv } from './findMpv'

describe('findMpv', () => {
  it('prefers FILESHUFFLER_MPV over everything else', () => {
    expect(
      findMpv({
        env: { FILESHUFFLER_MPV: '/custom/mpv' },
        platform: 'darwin',
        exists: () => true
      })
    ).toBe('/custom/mpv')
  })

  it("never runs an mpv found inside the app's own folder", () => {
    // mpv is not shipped, so a copy there was put there by something else.
    const checked: string[] = []
    const found = findMpv({
      env: {},
      platform: 'win32',
      exists: (path) => {
        checked.push(path)
        return true
      }
    })
    expect(found).toBe('mpv.exe')
    expect(checked).toEqual([])
  })

  it('finds a Homebrew mpv on macOS, where Finder-launched apps have no shell PATH', () => {
    expect(
      findMpv({
        env: {},
        platform: 'darwin',
        exists: (path) => path === '/usr/local/bin/mpv'
      })
    ).toBe('/usr/local/bin/mpv')
  })

  it('uses the mpv chosen in Settings ahead of an installed one', () => {
    expect(
      locateMpv({
        env: {},
        platform: 'darwin',
        chosen: '/Users/someone/tools/mpv',
        exists: () => true
      })
    ).toEqual({ path: '/Users/someone/tools/mpv', source: 'settings' })
  })

  it('still lets FILESHUFFLER_MPV override a choice in Settings, for development', () => {
    expect(
      locateMpv({
        env: { FILESHUFFLER_MPV: '/dev/mpv' },
        platform: 'win32',
        chosen: 'D:\\Tools\\mpv\\mpv.exe'
      })
    ).toEqual({ path: '/dev/mpv', source: 'environment' })
  })

  it('says where it found mpv', () => {
    expect(
      locateMpv({
        env: {},
        platform: 'darwin',
        exists: (path) => path === '/opt/homebrew/bin/mpv'
      }).source
    ).toBe('installed')
    expect(
      locateMpv({
        env: {},
        platform: 'win32',
        chosen: null,
        exists: () => false
      })
    ).toEqual({ path: 'mpv.exe', source: 'path' })
  })

  it('falls back to mpv on the PATH', () => {
    expect(findMpv({ env: {}, platform: 'win32', exists: () => false })).toBe('mpv.exe')
    expect(findMpv({ env: {}, platform: 'darwin', exists: () => false })).toBe('mpv')
  })
})
