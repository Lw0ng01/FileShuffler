import { describe, expect, it } from 'vitest'
import {
  AUDIO_EXTENSIONS,
  categoryOf,
  DOCUMENT_EXTENSIONS,
  PHOTO_EXTENSIONS,
  shouldSkipFolder,
  systemSkipRules
} from './scanRules'
import { VIDEO_EXTENSIONS } from './videoFolder'

describe('categoryOf', () => {
  it('sorts allowlisted files into categories, whatever the case', () => {
    expect(categoryOf('holiday.MP4')).toBe('video')
    expect(categoryOf('cat.jpg')).toBe('photo')
    expect(categoryOf('song.FLAC')).toBe('audio')
    expect(categoryOf('taxes.pdf')).toBe('document')
  })

  it('ignores anything not on the allowlist', () => {
    for (const name of ['setup.exe', 'library.dll', 'notes', 'archive.zip', 'player.ts']) {
      expect(categoryOf(name)).toBeNull()
    }
  })

  it('shares one video allowlist with the shuffler, so the two cannot drift', () => {
    for (const extension of VIDEO_EXTENSIONS) {
      expect(categoryOf(`clip${extension}`)).toBe('video')
    }
  })

  it('keeps the categories separate', () => {
    const sets = [VIDEO_EXTENSIONS, PHOTO_EXTENSIONS, AUDIO_EXTENSIONS, DOCUMENT_EXTENSIONS]
    const all = sets.flatMap((set) => [...set])
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('shouldSkipFolder', () => {
  const windows = systemSkipRules('win32', 'C:\\Users\\someone')
  const mac = systemSkipRules('darwin', '/Users/someone')

  it('skips Windows system and program locations, whatever the case', () => {
    for (const path of [
      'C:\\Windows',
      'C:\\Windows\\System32',
      'C:\\program files\\app',
      'C:\\Program Files (x86)\\app',
      'C:\\ProgramData\\cache',
      'C:\\Users\\someone\\AppData\\Local'
    ]) {
      expect(shouldSkipFolder(path, path.split('\\').pop() as string, windows)).toBe(true)
    }
  })

  it('skips macOS system locations', () => {
    expect(shouldSkipFolder('/System/Library', 'Library', mac)).toBe(true)
    expect(shouldSkipFolder('/Users/someone/Library/Caches', 'Caches', mac)).toBe(true)
    expect(shouldSkipFolder('/Applications', 'Applications', mac)).toBe(true)
  })

  it('skips dot-folders and known junk folders anywhere', () => {
    expect(shouldSkipFolder('D:\\code\\.git', '.git', windows)).toBe(true)
    expect(shouldSkipFolder('D:\\code\\node_modules', 'node_modules', windows)).toBe(true)
    expect(shouldSkipFolder('D:\\$RECYCLE.BIN', '$RECYCLE.BIN', windows)).toBe(true)
    expect(
      shouldSkipFolder('D:\\System Volume Information', 'System Volume Information', windows)
    ).toBe(true)
  })

  it('skips program installs and developer tool folders on any drive, not just C:', () => {
    for (const path of [
      'D:\\Program Files',
      // The rule judges a folder by its own name; the scanner never goes inside a skipped one.
      'D:\\Program Files (x86)',
      'E:\\SteamLibrary\\steamapps',
      'D:\\WindowsApps',
      'C:\\Users\\someone\\Documents\\project\\venv\\Lib\\site-packages',
      'C:\\Users\\someone\\Documents\\project\\__pycache__'
    ]) {
      expect(shouldSkipFolder(path, path.split('\\').pop() as string, windows)).toBe(true)
    }
  })

  it('allows ordinary personal folders', () => {
    expect(shouldSkipFolder('D:\\Videos\\Clips', 'Clips', windows)).toBe(false)
    expect(shouldSkipFolder('C:\\Users\\someone\\Pictures', 'Pictures', windows)).toBe(false)
    expect(shouldSkipFolder('/Users/someone/Movies', 'Movies', mac)).toBe(false)
  })

  it('does not mistake a similarly named folder for a system one', () => {
    expect(shouldSkipFolder('D:\\Windows Wallpapers', 'Windows Wallpapers', windows)).toBe(false)
    expect(shouldSkipFolder('C:\\Windows2', 'Windows2', windows)).toBe(false)
  })
})
