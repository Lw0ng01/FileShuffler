# CLAUDE.md

Read `PROJECT.md` first. It holds the vision, safety rules, shuffle design, roadmap, open questions
and a dated change log. Add a Change Log entry there for any major change or decision.

Lucas chose this stack partly to learn: explain *why* when making non-obvious choices.

## Hard rules (details in PROJECT.md §2)
- Never permanently delete files. Trash only (`shell.trashItem`), and fail closed if trashing
  isn't possible.
- Scanning is read-only and skips system locations and symlinks/junctions.
- A shuffle session only reads the top level of the chosen folder, never subfolders.
- No network calls. Never commit media, caches, index DBs, or config containing real file paths.

## Stack
Electron + React + TypeScript via electron-vite. Tests use vitest.
- `src/main/`: Electron main process (Node APIs: filesystem, trash, launching mpv/VLC)
- `src/preload/`: the safe bridge that exposes selected main-process functions to the UI
- `src/renderer/`: React UI

Requires **Node ≥ 22.12**. Developed on Node 26 with Electron 44; Electron ≤ 39 fails to unpack
on Node 26 (see PROJECT.md §5).
- Electron downloads its binary on the first `npm run dev`, not during `npm install`.
- A passing `npm run build` does **not** prove Electron is installed. Run
  `node_modules/.bin/electron --version`.
- npm 11 only runs install scripts listed in `package.json` → `allowScripts`, pinned to exact
  versions. After upgrading esbuild, fsevents or electron-winstaller, run
  `npm install-scripts ls` and approve the new version.

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
