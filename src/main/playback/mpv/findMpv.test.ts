import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findMpv, locateMpv } from './findMpv'

describe('findMpv', () => {
  it('prefers FILESHUFFLER_MPV over everything else', () => {
    expect(
      findMpv({
        env: { FILESHUFFLER_MPV: '/custom/mpv' },
        platform: 'darwin',
        resourcesPath: '/app/resources',
        exists: () => true
      })
    ).toBe('/custom/mpv')
  })

  it('uses the copy bundled with a packaged app', () => {
    const bundled = join('/app/resources', 'mpv', 'mpv.exe')
    expect(
      findMpv({
        env: {},
        platform: 'win32',
        resourcesPath: '/app/resources',
        exists: (path) => path === bundled
      })
    ).toBe(bundled)
  })

  it('finds a Homebrew mpv on macOS, where Finder-launched apps have no shell PATH', () => {
    expect(
      findMpv({
        env: {},
        platform: 'darwin',
        resourcesPath: null,
        exists: (path) => path === '/usr/local/bin/mpv'
      })
    ).toBe('/usr/local/bin/mpv')
  })

  it('uses the mpv chosen in Settings ahead of a bundled or installed one', () => {
    expect(
      locateMpv({
        env: {},
        platform: 'win32',
        resourcesPath: '/app/resources',
        chosen: 'D:\\Tools\\mpv\\mpv.exe',
        exists: () => true
      })
    ).toEqual({ path: 'D:\\Tools\\mpv\\mpv.exe', source: 'settings' })
  })

  it('still lets FILESHUFFLER_MPV override a choice in Settings, for development', () => {
    expect(
      locateMpv({
        env: { FILESHUFFLER_MPV: '/dev/mpv' },
        platform: 'win32',
        resourcesPath: null,
        chosen: 'D:\\Tools\\mpv\\mpv.exe'
      })
    ).toEqual({ path: '/dev/mpv', source: 'environment' })
  })

  it('says where it found mpv', () => {
    const bundled = join('/app/resources', 'mpv', 'mpv.exe')
    expect(
      locateMpv({
        env: {},
        platform: 'win32',
        resourcesPath: '/app/resources',
        exists: (path) => path === bundled
      }).source
    ).toBe('bundled')
    expect(
      locateMpv({
        env: {},
        platform: 'darwin',
        resourcesPath: null,
        exists: (path) => path === '/opt/homebrew/bin/mpv'
      }).source
    ).toBe('installed')
    expect(
      locateMpv({
        env: {},
        platform: 'win32',
        resourcesPath: null,
        chosen: null,
        exists: () => false
      })
    ).toEqual({ path: 'mpv.exe', source: 'path' })
  })

  it('falls back to mpv on the PATH', () => {
    expect(findMpv({ env: {}, platform: 'win32', resourcesPath: null, exists: () => false })).toBe(
      'mpv.exe'
    )
    expect(findMpv({ env: {}, platform: 'darwin', resourcesPath: null, exists: () => false })).toBe(
      'mpv'
    )
  })
})
