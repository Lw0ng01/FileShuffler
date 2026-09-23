/**
 * Builds every app icon file from `build/icon.svg`. Run with `npm run icons` after changing it.
 *
 * - `build/icon.ico`  - Windows: the installer, the exe, the taskbar and the Start menu.
 * - `build/icon.icns` - macOS: the app bundle, the Dock and Finder.
 * - `build/icon.png`  - electron-builder's fallback for anything without a native format.
 * - `resources/icon.png` - the window icon on Linux (`mainWindow.ts`).
 *
 * It renders with Electron's own Chromium, which the project already has, rather than adding an
 * image library for something that runs once in a while. Each size is rasterised straight from the
 * vector, not scaled down from a big bitmap, so the small ones stay sharp.
 *
 * The .ico and .icns are written here too. Both are thin wrappers around PNG data, and writing
 * them is a few lines, where the tools that make them are platform-specific: `iconutil` exists only
 * on macOS, so a Windows machine could not otherwise rebuild the Mac icon.
 *
 * Runs as an Electron main script: `electron scripts/make-icons.mjs`.
 */
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const MASTER = path.join(ROOT, 'build', 'icon.svg')

/** Sizes at or below this get a heavier glyph: a 2.6-unit stroke is under a pixel at 16px. */
const SMALL = 32

/**
 * The master as-is, or adjusted for a use:
 * - `small` thickens the shuffle glyph, which otherwise disappears at taskbar sizes.
 * - `mac` shrinks the artwork onto Apple's icon grid (an 824px body on a 1024 canvas) with a soft
 *   shadow. A full-bleed plate is right on Windows but looks oversized beside other Dock icons.
 */
function variant(svg, { small = false, mac = false } = {}) {
  let out = svg.replace(/<!--[\s\S]*?-->/g, '')
  if (small) {
    const thicker = out.replace(/(id="glyph"[^>]*?)stroke-width="2\.6"/, '$1stroke-width="3.6"')
    if (thicker === out)
      throw new Error('build/icon.svg: the glyph group lost id="glyph" or its 2.6 stroke')
    out = thicker
  }
  if (mac) {
    const shadow =
      '<filter id="macShadow" x="-10%" y="-10%" width="120%" height="130%">' +
      '<feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.28"/>' +
      '</filter></defs><g transform="translate(65 57) scale(0.8729)" filter="url(#macShadow)">'
    out = out.replace('</defs>', shadow).replace('</svg>', '</g></svg>')
  }
  return out
}

/**
 * One Windows icon image as a classic 32-bit bitmap: rows bottom-up in BGRA, then a 1-bit mask.
 *
 * Only the 256px entry may be PNG. Writing the small sizes as PNG looked fine to the shell but
 * came back as random noise through Windows' own icon loader, and plenty of software reads icons
 * that way - which is how a broken icon would have reached a taskbar or an Explorer list. This is
 * also the layout the previous, known-good icon used.
 */
function dib(size, rgba) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  // Twice the height: the colour bitmap and the mask are stacked, as icons always have been.
  header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  const pixels = Buffer.alloc(size * size * 4)
  const maskRow = Math.ceil(size / 32) * 4
  const mask = Buffer.alloc(maskRow * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = ((size - 1 - y) * size + x) * 4
      const to = (y * size + x) * 4
      pixels[to] = rgba[from + 2]
      pixels[to + 1] = rgba[from + 1]
      pixels[to + 2] = rgba[from]
      pixels[to + 3] = rgba[from + 3]
      // Fully transparent pixels are masked too, for anything that ignores the alpha channel.
      if (rgba[from + 3] === 0) mask[y * maskRow + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  header.writeUInt32LE(pixels.length + mask.length, 20)
  return Buffer.concat([header, pixels, mask])
}

/** Windows icon: a directory of images, bitmaps up to 128px and PNG at 256px (see `dib`). */
function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const directory = Buffer.alloc(16 * images.length)
  let offset = header.length + directory.length
  images.forEach(({ size, data }, i) => {
    const at = i * 16
    // 0 means 256: the field is a single byte.
    directory[at] = size >= 256 ? 0 : size
    directory[at + 1] = size >= 256 ? 0 : size
    directory.writeUInt16LE(1, at + 4)
    directory.writeUInt16LE(32, at + 6)
    directory.writeUInt32LE(data.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += data.length
  })
  return Buffer.concat([header, directory, ...images.map((image) => image.data)])
}

/** macOS icon: a list of typed PNG chunks, the same layout `iconutil` produces. */
function icns(entries) {
  const chunks = entries.map(({ type, png }) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(8 + png.length, 4)
    return Buffer.concat([head, png])
  })
  const body = Buffer.concat(chunks)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + body.length, 4)
  return Buffer.concat([head, body])
}

/** The pixel size a PNG says it is, from its header. */
function pngSize(png) {
  if (png.readUInt32BE(12) !== 0x49484452) throw new Error('not a PNG')
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/**
 * macOS icon types and the pixel size each holds. The @2x ones are the Retina versions. Only the
 * PNG-based modern types, which is what Apple's own `iconutil` writes; macOS scales down from
 * `ic11` for the rare 16px case rather than needing a legacy entry for it.
 */
const ICNS_TYPES = [
  ['ic11', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic13', 256],
  ['ic08', 256],
  ['ic14', 512],
  ['ic09', 512],
  ['ic10', 1024]
]

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

app
  .whenReady()
  .then(async () => {
    const master = fs.readFileSync(MASTER, 'utf8')
    const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
    await window.loadURL('data:text/html,<body></body>')

    /** Draws the SVG at `size` and hands back either a PNG or the raw RGBA pixels. */
    const draw = (svg, size, raw) => {
      const source = Buffer.from(svg).toString('base64')
      return window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = ${size}
        canvas.height = ${size}
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0, ${size}, ${size})
        if (!${raw}) return resolve(canvas.toDataURL('image/png').split(',')[1])
        const pixels = context.getImageData(0, 0, ${size}, ${size}).data
        let binary = ''
        for (let i = 0; i < pixels.length; i++) binary += String.fromCharCode(pixels[i])
        resolve(btoa(binary))
      }
      image.onerror = () => reject(new Error('the SVG would not render'))
      image.src = 'data:image/svg+xml;base64,${source}'
    })`)
    }

    const render = async (svg, size) => {
      const png = Buffer.from(await draw(svg, size, false), 'base64')
      const actual = pngSize(png)
      if (actual.width !== size || actual.height !== size) {
        throw new Error(`asked for ${size}px, got ${actual.width}x${actual.height}`)
      }
      return png
    }

    const pixels = async (svg, size) => {
      const rgba = Buffer.from(await draw(svg, size, true), 'base64')
      if (rgba.length !== size * size * 4)
        throw new Error(`asked for ${size}px of pixels, got ${rgba.length} bytes`)
      return rgba
    }

    const full = variant(master)
    const fullSmall = variant(master, { small: true })
    const mac = variant(master, { mac: true })
    const macSmall = variant(master, { mac: true, small: true })

    const icoImages = []
    for (const size of ICO_SIZES) {
      const svg = size <= SMALL ? fullSmall : full
      const data = size >= 256 ? await render(svg, size) : dib(size, await pixels(svg, size))
      icoImages.push({ size, data })
    }
    const icnsEntries = []
    for (const [type, size] of ICNS_TYPES) {
      icnsEntries.push({ type, png: await render(size <= SMALL ? macSmall : mac, size) })
    }

    const written = {
      'build/icon.ico': ico(icoImages),
      'build/icon.icns': icns(icnsEntries),
      'build/icon.png': await render(full, 1024),
      'resources/icon.png': await render(full, 512)
    }
    for (const [file, data] of Object.entries(written)) {
      fs.writeFileSync(path.join(ROOT, file), data)
      console.log(`make-icons: ${file} (${(data.length / 1024).toFixed(0)} KB)`)
    }
    app.exit(0)
  })
  .catch((error) => {
    console.error(`make-icons: ${error instanceof Error ? error.message : String(error)}`)
    app.exit(1)
  })
