# FileShuffler

Personal desktop app: shuffle-play a folder of videos in mpv or VLC (next / back / delete to
Recycle Bin), plus a dashboard of personal files across drives (later).

Built with Electron + React + TypeScript (electron-vite).
See [PROJECT.md](PROJECT.md) for the plan, safety rules and roadmap.

## Develop

```bash
npm install
npm run dev        # run the app with hot reload
npm test           # unit tests (vitest)
npm run typecheck
```

## Build

```bash
npm run build:win  # Windows installer
npm run build:mac  # macOS .dmg
```
