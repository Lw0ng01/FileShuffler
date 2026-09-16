# CLAUDE.md

Read `PROJECT.md` first. It holds the vision, safety rules (§2), shuffle design (§3), playback plan
(§4), stack/architecture/efficiency (§5), roadmap (§7) and a dated change log.
- Add a Change Log entry there for any major change or decision.
- This file covers *how to work in the code*. Link to PROJECT.md instead of restating it here.

This is headed for a public download other people install (PROJECT.md §1), so "works on Lucas's
machine" isn't the bar: assume no mpv, unfamiliar drives, and nobody to ask when something breaks.

Lucas wants a working shuffler first, then a dashboard with a custom built-in native player.
Efficiency and good architecture matter too. Explain why non-obvious choices fit. Don't promise
low memory use or migrate stacks for prestige: measurements and the embedded-player prototype
drive stack decisions.

## Hard rules (full text in PROJECT.md §2)

- Never permanently delete. Trash only (`shell.trashItem`) and fail closed. Extra confirmation
  never permits a permanent delete.
- Deletes still in the undo window are cancelled on exit and never replayed. Recheck the file's
  identity before trashing.
- Scanning is read-only and skips system locations and symlinks/junctions. A shuffle session reads
  only the chosen folder's top level.
- No network calls. Never commit media, caches, index DBs, or config containing real file paths.

## Stack and layout

Electron + React + TypeScript via electron-vite. Tests use vitest.
- `src/main/`: main process: application coordinator and adapters (filesystem, trash, player control)
  - `src/main/domain/`: pure logic with tests beside it (`shuffle.ts` is the shuffle engine,
    PROJECT.md §3)
  - `src/main/app/`: the coordinator that connects the shuffle session to a player
  - `src/main/playback/`: the player interface (`types.ts`) and the mpv adapter (`mpv/`,
    PROJECT.md §4)
  - `src/main/files/`: read-only folder listing and file identity checks (PROJECT.md §2), saved
    cycle progress (`progressStore.ts`), and the indexer's scan rules and walker (`scanRules.ts`,
    `scanner.ts`). Only `progressStore.ts` writes, and only inside the app's data folder
  - `src/main/library/`: the index store (`indexDb.ts`) on Node's built-in SQLite (PROJECT.md §5)
  - `src/main/app/indexerService.ts`: roots, scans and the numbers the dashboard reads
  - `src/main/libraryIpc.ts`: library commands, with the same sender and argument checks as `ipc.ts`
  - `src/main/app/statsService.ts` and `src/main/statsIpc.ts`: play stats and favorites, read from
    the same database. Play history is recorded through the coordinator's `PlayHistory`
  - `src/main/app/settingsService.ts` and `src/main/settingsIpc.ts`: the Settings tab. Settings are
    stored in `files/settingsStore.ts`; mpv is located by `playback/mpv/findMpv.ts` (`locateMpv`)
    and checked by `playback/mpv/probeMpv.ts` before a choice is saved
  - `src/main/app/shufflerService.ts`: one folder session (shuffle, coordinator, player lifecycle)
  - `src/main/ipc.ts`: renderer commands, with sender and argument checks
- `src/preload/`: the only bridge to the UI. Expose narrow, typed functions; keep `index.d.ts` in sync
- `src/renderer/`: React UI, presentation only (`components/`, one hook per area in `hooks/`, and
  shared display formatting in `format.ts`). The sidebar switches between Shuffle, Dashboard,
  Stats and Settings
- `src/shared/shuffler.ts`, `library.ts`, `stats.ts` and `settings.ts`: the view types, API types
  and channel names shared by all three

## Toolchain gotchas

- Node ≥ 22.12 (developed on Node 26). Electron ≤ 39 can't unpack on Node 26; stay on Electron 44+.
- Electron downloads its binary on first run, not on install. A passing build doesn't prove
  Electron works: run `node_modules/.bin/electron --version`.
- npm 11 runs only the install scripts listed in `package.json` → `allowScripts` (exact
  versions). After upgrading esbuild, fsevents or electron-winstaller, run
  `npm install-scripts ls` and approve.
- Windows: `lstat` reports `ENOENT` for a missing folder or drive too, not only a missing file
  (see `fileIdentity.ts`). winget's mpv (`shinchiro.mpv`) isn't on the PATH until you add
  `C:\Program Files\MPV Player` or set `FILESHUFFLER_MPV`.
- Windows PowerShell blocks `npm.ps1` under the default execution policy. Use Command Prompt or
  `npm.cmd` (PROJECT.md §5).
- `npm run dev` and an installed build use different app-data folders (`file-shuffler` vs
  `FileShuffler`), so saved cycle progress doesn't carry between them.

## Code rules

- Shuffle/cycle/history logic is pure TypeScript with no React, Electron, filesystem or player
  imports. Inject randomness.
- One application coordinator owns navigation, end-of-file, playback requests and pending trash.
  Use explicit states and request IDs so late events can't double-advance or overwrite newer state.
- Players sit behind one playback adapter interface (mpv now, VLC in Phase 2, embedded later).
  - Don't assume pushed events: VLC is polled.
  - Unload the file and observe completion before trashing it.
- Keep the security baseline:
  - In `src/main/index.ts`: sandbox on, context isolation on, Node integration off, navigation and
    new windows blocked. Keep the strict CSP in `src/renderer/index.html`.
  - Validate IPC senders and input at runtime in main.
  - Never expose raw `ipcRenderer`, shell execution or arbitrary paths. File actions resolve
    against the active session.
- Player control uses structured local IPC, never interpolated shell strings. Don't register plain
  arrows/Delete as global shortcuts.
- Use async I/O, bounded concurrency and bounded history/caches. Clean up processes, listeners and
  timers.
- No speculative plugin/service frameworks. SQLite arrives with the indexer.

## Verification

- Shuffle: deterministic invariant tests (empty/small folders, cycle seams, coverage, Back/Forward,
  undo/delete mid-history). A statistical test doesn't prove uniformity.
- Runtime changes: typecheck/build aren't enough; launch the app and exercise the flow. Test real
  OS trash and file-lock behavior with disposable files, on Windows where it matters.
- Performance claims need measurements from a packaged build (PROJECT.md §5). Never invent results.

## Commands

```bash
npm install
npm run dev         # run app with hot reload
npm test            # vitest (unit tests)
MPV_PATH=/path/to/mpv npm test   # also run the real-mpv integration tests
FILESHUFFLER_MPV=/path/to/mpv npm run dev   # force a specific mpv; beats the choice in Settings
npm run typecheck
npm run lint
npm run build       # typecheck + production build into out/
npm run build:win   # Windows installer
npm run build:mac   # macOS dmg
```
