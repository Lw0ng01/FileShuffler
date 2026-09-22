#!/usr/bin/env node
/**
 * Puts Chromium's licence notices next to the installers, ready to upload with a release.
 *
 * A packaged build embeds Chromium, whose components carry several hundred separate licences, and
 * those licences require their notices to travel with the binary. Electron ships them as one
 * `LICENSES.chromium.html` at the root of its distribution zip - but electron-builder pulls
 * `Electron.app` out of that zip and leaves the siblings behind, so nothing reaches the app.
 *
 * The file is about 20 MB. It goes beside the installer rather than inside it: the obligation is
 * that the notice accompanies the distribution, and bundling it would add a sixth to every
 * download for a file nobody opens twice.
 *
 * Run by `build:mac` and `build:win`, or on its own with `npm run licenses`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Both notices Electron ships: Chromium's aggregate credits, and Electron's own MIT licence. */
const WANTED = ['LICENSES.chromium.html', 'LICENSE']
const OUT_DIR = 'dist'

/** The version actually installed, not the range in package.json. */
function electronVersion() {
  const manifest = join('node_modules', 'electron', 'package.json')
  if (!existsSync(manifest)) {
    fail('node_modules/electron is missing. Run `npm ci` first.')
  }
  return JSON.parse(readFileSync(manifest, 'utf8')).version
}

/** Where `@electron/get` caches downloads, which is per-user and per-platform. */
function cacheRoot() {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'electron')
  if (process.platform === 'win32') {
    return join(
      process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'),
      'electron',
      'Cache'
    )
  }
  return join(process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'), 'electron')
}

/** The cache stores each download in a hash-named folder, so the zip has to be looked for. */
function findZip(version) {
  const root = cacheRoot()
  if (!existsSync(root)) return null
  const name = `electron-v${version}-${process.platform}-${process.arch}.zip`
  for (const entry of readdirSync(root)) {
    const candidate = join(root, entry, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function extract(zip, outDir) {
  if (process.platform === 'win32') {
    // Untested from macOS. PowerShell is used rather than `unzip`, which Windows has no built-in
    // equivalent of; if this ever fails, extracting the two files by hand is a fine substitute.
    const script = WANTED.map(
      (file) =>
        `$e = [IO.Compression.ZipFile]::OpenRead('${zip}').Entries | Where-Object { $_.FullName -eq '${file}' };` +
        ` if ($e) { [IO.Compression.ZipFileExtensions]::ExtractToFile($e, '${join(outDir, file)}', $true) }`
    ).join(' ')
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Add-Type -AssemblyName System.IO.Compression.FileSystem; ${script}`
      ],
      { stdio: 'inherit' }
    )
    return
  }
  // `-j` flattens, `-o` overwrites: the files sit at the root of the zip already.
  execFileSync('unzip', ['-o', '-j', zip, ...WANTED, '-d', outDir], { stdio: 'inherit' })
}

function fail(message) {
  console.error(`chromium-licenses: ${message}`)
  process.exit(1)
}

const version = electronVersion()
const zip = findZip(version)
if (zip === null) {
  fail(
    `no cached Electron ${version} download for ${process.platform}-${process.arch}.\n` +
      '  The zip appears once Electron has been fetched - run the app or a build once, then retry.'
  )
}

mkdirSync(OUT_DIR, { recursive: true })
extract(zip, OUT_DIR)

for (const file of WANTED) {
  const path = join(OUT_DIR, file)
  if (!existsSync(path)) fail(`${file} was not extracted from ${zip}`)
  const mb = (statSync(path).size / 1024 / 1024).toFixed(1)
  console.log(`chromium-licenses: ${path} (${mb} MB)`)
}
console.log('chromium-licenses: upload both alongside the installer on the release.')
