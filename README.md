# FileShuffler

Shuffle-play a folder of videos properly, and see what is actually taking up space on your drives.

A small desktop app for Windows and macOS. It plays videos **in the app**, in a random order that
plays every video once before any repeats, and it can move files to the Recycle Bin or Trash as you
watch - with a few seconds to undo.

It is completely local. No accounts, no telemetry, no network requests of any kind.

## What it does

- **Shuffle** - pick a folder and play through it. Every video plays once per cycle before any
  repeats, so you stop seeing the same three files. Next, Back, and Delete with an undo window.
- **Dashboard** - index the folders you choose and see space by category, per-drive free space, your
  largest and most recently changed files, and a search across them.
- **Cleanup** - the folders using the most space, files that look like copies of each other, and big
  files nothing has touched in months. It only ever shows you things; it never deletes on its own.
- **Stats** - what you have actually watched: most played, recently played, never played, favourites.
- **Settings** - which folders are indexed, which are excluded, light or dark appearance, and one
  button per kind of saved data if you want it gone.

## Deleting is always undoable

Files go to the **Recycle Bin on Windows** or the **Trash on macOS**, never anywhere else. There is
no permanent-delete path in the app at all. If a file cannot be recycled - some USB sticks and
network shares cannot - the delete is refused and the file is kept, rather than deleted for good.

Every delete waits a few seconds first, so Undo can cancel it, and anything still waiting is
cancelled if you close the app.

## Installing

Downloads are on the [Releases page](https://github.com/Lw0ng01/FileShuffler/releases).

**The app is not code-signed**, because a signing certificate costs money every year and this is a
personal project given away for free. Both systems will therefore warn you the first time:

- **macOS** - open the `.dmg`, drag FileShuffler to Applications, then **right-click the app and
  choose Open** the first time. A plain double-click will refuse. macOS remembers after that.
- **Windows** - run the installer. SmartScreen shows "Windows protected your PC": click
  **More info**, then **Run anyway**.

Only do this because you trust where you got the file. The source is all here if you would rather
read it or build it yourself.

Apple Silicon Macs only for now; the Windows build is 64-bit.

## Playing videos

Video plays inside the app, with its own controls and fullscreen. A few formats Chromium cannot
decode - some `.avi` and `.wmv` files - open in whatever player your system already uses, and the
shuffle waits for you rather than starting the next one underneath it.

**mpv is optional.** If you install it and point Settings at it, videos play in mpv's own window
instead. Nothing requires it.

## Where your data is kept

Everything stays on your computer:

- Windows: `%APPDATA%\FileShuffler`
- macOS: `~/Library/Application Support/FileShuffler`

That folder holds the file index, play history, favourites and shuffle progress. Deleting it resets
the app; your videos are never in it. Settings can clear each kind separately.

Scanning is read-only. It skips system and program folders, and never follows shortcuts or symlinks.

## Building it yourself

```bash
npm install
npm run dev          # run with hot reload
npm test             # unit tests
npm run build:win    # Windows installer
npm run build:mac    # macOS .dmg
```

Node 22.12 or newer. See [docs/PROJECT.md](docs/PROJECT.md) for the design, the safety rules and the full
change log, and [CLAUDE.md](CLAUDE.md) for how to work in the code.

## Licence

[MIT](LICENSE) - use it, fork it, ship it, just keep the copyright notice.

FileShuffler bundles Electron and Chromium, which carry their own licences. See
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
