# CLAUDE.md

Read `PROJECT.md` first. It holds the vision, safety rules, shuffle design, roadmap, open questions
and a dated change log. Add a Change Log entry there for any major change or decision.

Lucas wants a working shuffler first, then a dashboard with a custom built-in native player.
All of these matter, as do efficiency and demonstrating good system architecture. Explain why
non-obvious choices fit the requirements. Keep Electron/React/TypeScript for the initial work;
do not promise low memory use or migrate stacks for prestige. Use measurements and the early
embedded-player prototype to inform any later stack decision.

## Hard rules (details in PROJECT.md §2)

- Never permanently delete files. Trash only (`shell.trashItem`), and fail closed if trashing
  isn't possible. Extra confirmation never permits permanent deletion.
- Cancel trash actions still in the undo window on exit; never replay them on restart. Restore
  the item on undo/failure. Recheck the target before trashing; cancel if its identity is uncertain.
- Scanning is read-only and skips system locations and symlinks/junctions.
- A shuffle session only reads the top level of the chosen folder, never subfolders.
- No network calls. Never commit media, caches, index DBs, or config containing real file paths.

## Stack

Electron + React + TypeScript via electron-vite. Tests use vitest.
- `src/main/`: Electron main process (coordination and adapters: filesystem, trash, controlling mpv)
- `src/preload/`: the safe bridge that exposes selected main-process functions to the UI
- `src/renderer/`: React UI

### Inherited setup notes

These notes describe the initial setup; the architecture review did not revalidate version or
installer claims. Check the actual lockfile and tool versions before changing the toolchain.

Requires **Node ≥ 22.12**. Developed on Node 26 with Electron 44; Electron ≤ 39 fails to unpack
on Node 26 (see PROJECT.md §5).
- Electron downloads its binary on the first `npm run dev`, not during `npm install`.
- A passing `npm run build` does **not** prove Electron is installed. Run
  `node_modules/.bin/electron --version`.
- npm 11 only runs install scripts listed in `package.json` → `allowScripts`, pinned to exact
  versions. After upgrading esbuild, fsevents or electron-winstaller, run
  `npm install-scripts ls` and approve the new version.

## Architecture and implementation approach

- Keep shuffle/cycle/history rules in pure TypeScript modules independent of React, Electron,
  the filesystem, and mpv. Inject randomness for deterministic tests.
- Use one application coordinator for navigation, EOF, playback requests, and pending trash.
  Explicit states and request identities must prevent double-advance and stale-event races.
- Introduce small interfaces for playback, file operations, and persistence as needed. The
  external/embedded playback boundary can preserve logic, but native rendering needs real work.
- Renderer owns presentation and sends narrow commands through preload. Keep Node integration
  off, context isolation and sandboxing on, and a restrictive CSP. Validate IPC senders and input
  at runtime in the main process; TypeScript types alone are insufficient. Do not expose raw
  IPC, shell execution, or unrestricted file operations to the renderer.
- Use asynchronous I/O and bounded concurrency. Keep CPU-heavy indexing/probing/thumbnails off
  the main/UI threads when those features arrive. Clean up processes, subscriptions, and timers.
- Bound history/cache growth. Add SQLite with the indexer; avoid speculative service/plugin
  frameworks. Document substantive decisions and limitations briefly in PROJECT.md.

## Playback and delivery order

- Deliver one complete flow first: choose folder → shuffle → external mpv → Next/Back → trash
  with undo. Bundle only mpv initially, keeping one controlled process alive between videos.
- Route player-local shortcuts into the application coordinator. System-wide shortcuts are
  optional/configurable; do not register plain arrows/Delete globally by default.
- Unload before trashing and observe completion. Handle load failure, player exit, file locks,
  and disconnects explicitly. Use structured local IPC commands rather than shell strings.
- After the first working flow, run the embedded native-player prototype in PROJECT.md §4,
  before extensive dashboard UI work. It must cover rendering, controls, fullscreen, file release,
  hardware decoding where available, and packaged Windows behavior. Assess macOS feasibility.
- HTML video is not a substitute for the planned broad-format native player. Do not promise
  "every format" or assume Qt/.NET/Tauri integration is effortless. Record supported combinations.
- Package and test on Windows during Phase 1, not only at the end. Dashboard and integrated
  player remain planned features; extra external players and bonus features are deferred.

## Verification and performance

- Test shuffle invariants with deterministic randomness: empty/small folders, cycle boundaries,
  coverage, Back/Forward, and undo/delete during navigation. A statistical test is not proof of
  uniformity. "Opened this cycle" requires a successful player load, not merely selection.
- Exercise rapid commands, EOF races, missing/unplayable files, player crashes, failed trash,
  and exit during the undo window. Verify actual OS behavior with disposable fixtures on Windows.
- Establish a packaged-build baseline covering launch time, idle/playback CPU and memory,
  seek latency, and dropped frames. Include every app/player/helper process with consistent
  metrics, record the machine and workload, then set explicit budgets. Do not invent results.
- Check repeated load/unload/navigation for memory or handle growth. Once indexing exists,
  measure browsing/scanning during playback and verify cancellation and bounded resource use.
- Run checks appropriate to the change. For runtime changes, typecheck/build alone cannot
  establish that Electron launches or the packaged player works; exercise the relevant flow.

## Commands

```bash
npm install
npm run dev         # run app with hot reload
npm test            # vitest (unit tests)
npm run typecheck
npm run lint
npm run build       # typecheck + production build into out/
npm run build:win   # Windows installer
npm run build:mac   # macOS dmg
```
