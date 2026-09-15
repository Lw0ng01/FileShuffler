import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findMpv } from './findMpv'

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

  it('falls back to mpv on the PATH', () => {
    expect(findMpv({ env: {}, platform: 'win32', resourcesPath: null, exists: () => false })).toBe(
      'mpv.exe'
    )
    expect(findMpv({ env: {}, platform: 'darwin', resourcesPath: null, exists: () => false })).toBe(
      'mpv'
    )
  })
})
