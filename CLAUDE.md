# CLAUDE.md

Read `docs/PROJECT.md` first. It holds the vision, safety rules (§2), shuffle design (§3), playback
plan (§4), stack/architecture/efficiency (§5), roadmap (§7) and a dated change log. It moved out of
the repository root on 2026-09-22 so the front page shows only what a visitor needs; every `PROJECT.md
§x` citation in the source still refers to it. `docs/LEARNING.md` is its companion: the *why* behind
the architecture and pipelines, written for learning from.
- Add a Change Log entry there for any major change or decision.
- This file covers *how to work in the code*. Link to PROJECT.md instead of restating it here.

This is headed for a public download other people install (PROJECT.md §1), so "works on Lucas's
machine" isn't the bar: assume no mpv, unfamiliar drives, and nobody to ask when something breaks.

Lucas wants a working shuffler first, then a dashboard with a custom built-in native player.
Efficiency and good architecture matter too. Explain why non-obvious choices fit. Don't promise
low memory use or migrate stacks for prestige: measurements and the embedded-player prototype
drive stack decisions.

## Working with Lucas

How sessions have gone, so a new one (on another machine, with no memory of earlier chats) works
the same way:
- **One branch per step.** `git fetch`, confirm the previous branch is merged, then branch from
  `origin/main` as `worktree-<topic>`. Never push to `main` or force-push. Lucas reviews and
  merges himself; end with the `https://github.com/Lw0ng01/FileShuffler/pull/new/<branch>` link.
- **Commits** are authored `Lucas W <71304042+Lw0ng01@users.noreply.github.com>`, with **no
  Claude co-author or session lines** (his choice).
- **Write commit messages and PR notes as the person who made the change**, because the author *is*
  Lucas: a message saying "Lucas asked for X" has him narrating himself in the third person, which
  is what makes them read as robotic.
  - Past tense, plain and direct. "The light background was too grey, so it's now `#f2f2f7`" - not
    "Lucas said the background looked too grey, and he was right".
  - Never name him, and never frame a change as carrying out an instruction. State the decision and
    why it was right: "Springs only on the moments that carry meaning" rather than "Lucas chose
    springs on the moments that matter".
  - Keep the reasoning and the honest caveats; drop the reporting. What changed, why, what it cost,
    what is still unverified.
  - **`PROJECT.md` is the exception**: it is a dated record of who decided what, so attributions
    like *(Lucas, 2026-09-16)* belong there and should stay.
- **Before committing:** `npm run lint`, `npm run typecheck`, `npm test` (with `MPV_PATH` when mpv
  is installed). Scan the staged diff for personal data: emails other than the noreply one, local
  paths, and real file or folder names from his library.
- **Every branch updates `PROJECT.md`** (Resume here and the Change Log) and this file when the
  layout or a convention changes.
- **Lucas is using the polish pass to learn** (2026-09-24). Every branch also adds an entry to the
  Log in `docs/LEARNING.md`, in the format given there: what changed, why, the alternatives and why
  not, the idea to keep, and a small "try it". Write it for someone learning, not reviewing - the
  concept underneath matters more than the diff. Correct the big-picture sections above the Log
  when a change proves them wrong.
- **Check behavior in the running app**, not just the tests. A packaged build writes to the
  installed app's data folder: use a copy of the data, and remove it afterwards. To check the UI
  without screenshots, launch with `--remote-debugging-port` and read the page text. **Never
  capture his whole screen**; it shows his own apps.
- **Features are frozen for v1.** New features need his OK first; he approved Excluded folders.
- He tests merged work himself and reports back. Explain in plain terms, recommend rather than list
  every option, and use multiple-choice questions for real decisions.

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
  - `src/main/index.ts`: startup and shutdown only. `services.ts` builds the services and joins
    them to Electron (the only place that does), `mainWindow.ts` holds the window and its security
    settings, and `dialogs.ts` every system picker and message box
  - `src/main/domain/`: pure logic with tests beside it (`shuffle.ts` is the shuffle engine,
    PROJECT.md §3)
  - `src/main/app/`: the coordinator that connects the shuffle session to a player
  - `src/main/playback/`: the player interface (`types.ts`) and the adapters behind it - the mpv
    adapter (`mpv/`) and the built-in player (`embedded/`, PROJECT.md §4). The built-in one plays
    in a `<video>` in the renderer, so its adapter is split: `embeddedPlayer.ts` in main,
    `VideoStage.tsx` in the renderer, joined by `playerIpc.ts`. The renderer is handed a load
    **token**, never a path; `videoProtocol.ts` serves `fsvideo://file/<token>` and is the only
    thing that knows which file that is
  - `src/main/files/`: read-only folder listing and file identity checks (PROJECT.md §2), saved
    cycle progress (`progressStore.ts`), and the indexer's scan rules and walker (`scanRules.ts`,
    `scanner.ts`). Only `progressStore.ts` writes, and only inside the app's data folder
  - `src/main/library/`: the index store (`indexDb.ts`) on Node's built-in SQLite (PROJECT.md §5).
    `openIndex.ts` sets a damaged index aside at startup instead of crashing
    - The database lives in a worker thread (`indexWorker.ts`). Services get an `IndexStore`
      (`indexStore.ts`): every operation returns a promise, answered in the order sent
      (`workerIndexStore.ts`). A new `IndexDb` method must be added to `INDEX_METHODS`, or the
      worker refuses it
    - Tests use `localIndexStore(new IndexDb(':memory:'))`, which answers a turn later like the
      worker does
  - `src/main/app/indexerService.ts`: roots, excluded folders (added to the scanner's skip rules
    at each scan), scans and the numbers the dashboard reads
  - `src/main/libraryIpc.ts`: library commands, with the same sender and argument checks as `ipc.ts`
  - `src/main/app/statsService.ts` and `src/main/statsIpc.ts`: play stats and favorites, read from
    the same database. Play history is recorded through the coordinator's `PlayHistory`
  - `src/main/app/settingsService.ts` and `src/main/settingsIpc.ts`: the Settings tab. Settings are
    stored in `files/settingsStore.ts`; mpv is located by `playback/mpv/findMpv.ts` (`locateMpv`)
    and checked by `playback/mpv/probeMpv.ts` before a choice is saved
  - `src/main/app/shufflerService.ts`: one folder session (shuffle, coordinator, player lifecycle)
  - `src/main/ipc.ts`: renderer commands, with sender and argument checks. The IPC tests share
    `testing/fakeIpc.ts`
- `src/preload/`: the only bridge to the UI. Expose narrow, typed functions; keep `index.d.ts` in sync
- `src/renderer/`: React UI, presentation only (`components/`, one hook per area in `hooks/`, and
  shared display formatting in `format.ts`). The sidebar switches between Dashboard, Shuffle,
  Cleanup, Stats and Settings, and Dashboard is the tab the app opens on. The dashboard's sections
  live in `components/dashboard/`
  - `.screen` is the 760px reading width; add `wide` to it (Dashboard, Cleanup, Stats) for screens
    built from lists and grids
  - Front-end conventions (tokens, the shape scale, motion, focus, adding a screen) live in the
    `fileshuffler-ui` skill, `.claude/skills/fileshuffler-ui/SKILL.md`. Read it before changing
    anything under `src/renderer/`, and move an entry from "Open" to "Recorded" once Lucas settles
    it
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
- App data is pinned in `src/main/index.ts`: `%APPDATA%\FileShuffler` for the installed app and
  `%APPDATA%\FileShuffler Dev` for `npm run dev`, kept separate on purpose. Don't rename them: that
  silently abandons saved data. mpv is not bundled in the installer (PROJECT.md §7 Phase 6).
- Each data folder allows one running copy: a second launch focuses the first window and exits.
  Launching `dist/win-unpacked/FileShuffler.exe` creates `%APPDATA%\FileShuffler`; remove it after
  testing unless the installed app is really in use on that machine.

## Code rules

- Shuffle/cycle/history logic is pure TypeScript with no React, Electron, filesystem or player
  imports. Inject randomness.
- One application coordinator owns navigation, end-of-file, playback requests and pending trash.
  Use explicit states and request IDs so late events can't double-advance or overwrite newer state.
- Players sit behind one playback adapter interface (mpv now, VLC in Phase 2, embedded later).
  - Don't assume pushed events: VLC is polled.
  - Unload the file and observe completion before trashing it.
- The built-in player never receives a path. It asks for `fsvideo://file/<token>` and main decides
  what the token means, so a compromised page cannot ask for a file it was not given. The CSP
  allows `media-src fsvideo:` and nothing else.
- Keep the security baseline:
  - In `src/main/mainWindow.ts`: sandbox on, context isolation on, Node integration off, navigation and
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
FILESHUFFLER_DATA=/path/to/copy npm run dev  # run against a copy of the data, not the real one
npm run typecheck
npm run lint
npm run build       # typecheck + production build into out/
npm run build:win   # Windows installer
npm run build:mac   # macOS dmg
npm run icons       # regenerate every icon file from build/icon.svg
```

The app icon has one source, `build/icon.svg`. `build/icon.ico`, `build/icon.icns`, `build/icon.png`
and `resources/icon.png` are generated from it by `scripts/make-icons.mjs`: never edit them by hand,
and commit them with the SVG so a build never needs the generator. Windows' small `.ico` sizes are
bitmaps on purpose - PNG ones decode as noise through Windows' own icon loader.
