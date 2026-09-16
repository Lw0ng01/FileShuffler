import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { probeMpv } from './probeMpv'

describe('probeMpv', () => {
  it('explains when nothing is at the chosen location', async () => {
    const result = await probeMpv(join(tmpdir(), 'fileshuffler-no-such-program.exe'))
    expect(result).toEqual({ ok: false, reason: 'No program was found at that location.' })
  })

  it('refuses a program that runs but is not mpv', async () => {
    // Node answers --version too, so it stands in for "some other program".
    expect(await probeMpv(process.execPath)).toEqual({
      ok: false,
      reason: "That program ran, but it isn't mpv."
    })
  })

  const mpvPath = process.env['MPV_PATH']
  it.skipIf(mpvPath === undefined)('reports the version of a real mpv', async () => {
    const result = await probeMpv(mpvPath as string)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.version).toMatch(/^mpv /i)
  })
})
