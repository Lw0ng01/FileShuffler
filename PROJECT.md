# FileShuffler — Project Doc

> Single source of truth for what we're building and why. Update it whenever a major decision or
> change happens (see Change Log at the bottom). `CLAUDE.md` covers *how to work in the code*;
> this file covers *what and why*.

**Status:** Phase 0 (project set up, no features yet) · **Stack:** Electron + React + TypeScript
(electron-vite) · **Name:** FileShuffler. Lucas doesn't care about the name;
keep it unless he says otherwise.

---

## 1. Vision

A small personal desktop app with two parts:

1. **Shuffler (the core):** point it at a folder of videos and play them in a *good* random order.
   Buttons for next, back and delete (sends the file to the Recycle Bin/Trash).
   Remake of an older Python app whose shuffle felt bad.
2. **Dashboard (bonus, later):** a good-looking "all-in-one" overview of the *personal* files on
   every drive: videos, pictures, documents, audio. System and background files are left out.

It doesn't need to be rigorous, but it **must never put files at risk.**

**Platforms:** Windows is the main target (Lucas's desktop). macOS is a nice-to-have (laptop).

## 2. Non-negotiable safety rules

1. **Read-only by default.** Scanning only reads metadata (name, size, dates). It never modifies,
   moves or renames anything.
2. **The only destructive action is "move to Recycle Bin/Trash".** No permanent delete anywhere
   in the codebase. If the OS can't send a file to the trash, **fail and show an error** instead of
   falling back to a permanent delete.
   - ⚠️ Windows: USB sticks and network drives often have **no Recycle Bin**, so deleting there is
     permanent. Turn delete off on those drives, or require an explicit extra confirmation.
   - ⚠️ Windows locks files that are open in another program. **Switch the player to the next
     video (or unload the file) before trashing it** (see §4).
3. **Undo window for delete.** Delete hides the file right away but only sends it to the trash
   after about 5 seconds, so it can be undone in the app. Pending deletes finish when the app closes.
4. **Allowlist, not blocklist, for file types.** Only index known personal-media and document
   extensions.
5. **Skip system locations:** `C:\Windows`, `Program Files*`, `ProgramData`, `AppData`,
   `$Recycle.Bin`, `System Volume Information`, `/System`, `/Library`, `~/Library`,
   `/Applications`, hidden/dot folders, `node_modules`, `.git`.
6. **Don't follow symlinks or junctions.** Windows AppData junctions can cause infinite loops.
7. **Fully local.** No network calls, no telemetry. Thumbnail and index caches stay on the machine
   and can be cleared from settings. (Talking to a local player over its local control channel is
   fine.)
8. **Nothing personal goes into git:** no media, caches, index database, or config holding real
   paths. Enforce this with `.gitignore`.

## 3. The shuffle algorithm (the main thing to get right)

### Scope of a shuffle session
- **Top level only.** Only video files directly inside the chosen folder are included.
  **Subfolders are ignored entirely** (not scanned, not played, never touched). *(Decided 2026-09-15.)*

### Why the old one probably felt bad
- **Picking with `random()` every time** (sampling *with replacement*) repeats videos quickly.
  With 100 videos there's about a 50% chance of a repeat within the first 12 picks (the birthday
  problem).
- **`array.sort(() => Math.random() - 0.5)`** is a common shortcut, and it's biased: it doesn't
  produce a uniform shuffle.
- Check this against the old code once Lucas shares it.

### The design: shuffle bag + playlist history
- **Fisher–Yates shuffle** of the whole file list gives a uniform random order with no repeats.
  Play through it in order. Every file plays once before any file plays twice.
- **One `playlist` array plus a `cursor`** handles navigation:
  - *Next:* `cursor + 1`. If that's past the end, pull the next file from the bag.
  - *Back:* `cursor - 1`. Pressing Next after Back replays the same order, like a browser's
    forward and back.
- **Endless, maximum-coverage cycles** *(decided)*: when the bag runs out, reshuffle and keep
  going. Make sure the first few picks of the new cycle weren't among the last *K* played (for
  example K = min(10, n/3)) to avoid back-to-back repeats at the seam.
- **Delete:** remove the file from both the playlist and the bag, and adjust the cursor.
- **New files found mid-session:** insert them at a random spot in the *unplayed* part of the bag.
- **Persist per folder:** save which files have been played this cycle, so reopening the app
  continues the cycle instead of starting fresh. This matters because the goal is coverage.

### Possible upgrades (later)
- **Weighting:** favor favorites or videos not seen in a long time, without breaking the
  no-repeat guarantee.
- The shuffle is pure logic, so it can be **unit-tested** (uniformity, no repeats within a cycle,
  seam rule, back/forward, delete while mid-history).

## 4. Playback: external player by default

Lucas has many formats (mkv, avi, etc.), so **the default is a separate player program**.
A built-in player is a later nice-to-have.

**The core problem:** the app's Next/Back/Delete must *control* another program. Three consequences:
- **Keyboard focus:** while the player is fullscreen, it gets the keypresses, so the app needs
  system-wide hotkeys, a floating control bar, or key bindings added inside the player.
- **File locks:** a video must be unloaded from the player before it can be trashed (§2.2).
- **How much control each player allows:**

| Player | Control method | Level |
|---|---|---|
| **mpv**, bundled with the app | JSON IPC (named pipe on Windows, unix socket on Mac). A Lua script can add → ← Del keys *inside* the mpv window. | Full: **recommended default** |
| **VLC** | Its HTTP interface, switched on through launch arguments | Good |
| **IINA** (Mac, mpv-based) | Probably mpv IPC passed through `iina-cli`. **Still to verify.** | Probably good |
| Any other player | Close and relaunch it with the next file | Basic: flickers, leaves fullscreen |

**Built-in player (later):**
- Web-based stacks (Electron) can play mp4/webm in-app, which is fine for dashboard previews.
- Embedding a player that plays every format is easy in Qt, Flutter or C# (libmpv/libVLC) and hard
  in Electron.

## 5. Tech stack: ✅ decided: TypeScript + Electron

**Chosen 2026-09-15:** Electron + React + TypeScript, scaffolded with electron-vite, tests with
vitest. Lucas picked it partly because it's more to learn.
- **Default player:** mpv, bundled.
- **VLC:** a supported option.
- **Custom built-in player:** Lucas still wants to try a more complex one later. It's a future
  project, not ruled out.
- **Requires Node ≥ 22.12**, because `electron-builder` loads an ESM-only library (`@noble/hashes`)
  using `require()`. On older Node, `npm install`'s postinstall fails with `ERR_REQUIRE_ESM`.
  The Mac is now on Node 26.8.2 / npm 11.19.1.
- **Electron 44+ is required on Node 26.**
  - Electron ≤ 39 unpacks its binary with `extract-zip` 2.0.1 / `yauzl` 2.10.0. On Node 26 that
    silently stops after the first file, leaving no `Electron.app` and giving "Electron failed to
    install correctly". It works on Node 24.
  - Upgraded to **Electron 44.3.0**, which uses `@electron-internal/extract-zip`. Verified on
    Node 26: clean install, build, and the app launches.
- **Electron 44 has no install script.** It downloads its binary the first time it runs (for
  example the first `npm run dev` prints "Downloading Electron binary...").
  - The download is cached in `~/Library/Caches/electron` (Mac) or
    `%LOCALAPPDATA%\electron\Cache` (Windows).
  - To download it ahead of time: `npx install-electron`.
- **npm 11 blocks packages' install scripts unless approved.** The approved list lives in
  `package.json` → `allowScripts`: esbuild (compiler binary), fsevents (Mac only),
  electron-winstaller (Windows installer builds).
  - Approvals are **pinned to exact versions**. After upgrading one of these packages, run
    `npm install-scripts ls` and approve the new version.

Options that were considered:

| | TypeScript + Electron | Python + PySide6 (Qt) + mpv |
|---|---|---|
| Good-looking dashboard | ✅ Easiest (web tech, familiar from his site) | ⚠️ More effort |
| Built-in player for every format | ❌ Hard | ✅ Easy (embed libmpv) |
| Controlling an external player | ✅ | ✅ |
| System-wide hotkeys / trash | ✅ Built in | ✅ Add-on packages |
| Packaging Windows + Mac | ✅ Mature | ⚠️ Clunkier, sometimes flagged by antivirus |
| Size | ~150 MB | ~60–100 MB |

Other options:
- **Flutter + media_kit:** modern UI plus an embedded player for every format, cross-platform.
  Requires learning Dart.
- **C# + Avalonia + LibVLCSharp:** strong on Windows, weaker Mac story.
- **Tauri:** the OS webview varies between platforms, which is bad for a video app. Skipped.

**Recommendation:**
- **TypeScript + Electron, with bundled mpv as the default player** and VLC/others as options.
  External playback is the default anyway, so the embedded-player advantage matters less.
- **Switch to Python + Qt** if a true built-in player for every format becomes a must-have.

## 6. Layout

Build the shuffler first, inside an app shell with a sidebar, so the dashboard slots in later.

```
┌──────────┬──────────────────────────────────────────────┐
│ ▶ Shuffle│  📁 D:\Videos\Clips            [Change]      │
│ ▦ Dash   │                                              │
│ ⚙ Setting│   Now playing: some_clip.mkv                 │
│          │   Cycle 2 · 140 / 340 seen                   │
│          │                                              │
│          │     [ ◀ Back ]  [ ⤮ Next ]  [ 🗑 Delete ]     │
│          │   Player: mpv ▾    Hotkeys: ← → Del          │
│          │                                              │
│          │   Recent:  clip_a.mp4 · clip_b.mkv · …       │
└──────────┴──────────────────────────────────────────────┘
```

Dashboard (later): row of drive cards (used/free), space-by-category bar, largest/recent file
lists. Not designed in detail yet.

## 7. Roadmap

### Phase 0 — Setup
- [x] Lucas picks the stack (§5): TypeScript + Electron
- [ ] Review the old Python code when Lucas shares it
- [x] Scaffold project (electron-vite react-ts), `.gitignore` with personal-data guards, vitest,
      fill in `CLAUDE.md` commands
- [x] Local git repo + first commit
- [x] Upgrade Node on the Mac to ≥ 22.12 (now 26.8.2). Use ≥ 22.12 on the Windows desktop too.
- [x] Approve npm 11 install scripts (`allowScripts` in package.json)
- [x] Upgrade Electron 39 → 44.3.0 (Electron 39 can't install on Node 26)
- [ ] Create **public** GitHub repo and push, **after the shuffler basics work** (end of Phase 1)

### Phase 1 — Shuffler MVP ⭐
- [ ] Pick folder (top-level files only)
- [ ] Scan for video files (allowlisted extensions)
- [ ] Shuffle engine (bag + playlist/cursor, endless cycles, seam rule) **with unit tests**
- [ ] mpv integration: launch, load file, detect end of video → autoplay next, key bindings inside mpv
- [ ] Next / Back / Delete-to-trash (unload first, undo window)
- [ ] App shell with sidebar + shuffler screen (§6), system-wide hotkeys
- [ ] Show current filename + cycle progress

### Phase 2 — Shuffler polish
- [ ] Remember last folder and shuffle progress between launches
- [ ] Player choice: VLC (HTTP interface), IINA (verify), generic relaunch fallback
- [ ] "Show in Explorer/Finder" button
- [ ] Favorites / weighting
- [ ] Optional in-app player for common formats

### Phase 3 — Indexer (feeds the dashboard)
- [ ] Settings: choose which drives/folders to index (default: user Videos, Pictures, Documents,
      Downloads, Desktop)
- [ ] Safe background scanner (rules in §2) → SQLite
- [ ] Incremental rescans

### Phase 4 — Dashboard
- [ ] Drives: capacity / used / free
- [ ] Breakdown by category
- [ ] Largest files, recently added, search
- [ ] "Shuffle this" from a folder in the dashboard

### Phase 5 — Bonus ideas
- [ ] Thumbnail gallery for photos/videos
- [ ] Duplicate finder (view-only, with trash as the only action)
- [ ] Watch stats: most played, never watched, total hours of video
- [ ] "Old Downloads" cleanup suggestions (view-only)

### Phase 6 — Distribution
- [ ] Packaged builds: Windows first, then Mac

## 8. Concerns / risks
- **Controlling an external player** is the trickiest part of the MVP (focus, file locks,
  per-player differences). mpv first keeps it manageable.
- **Scanning every drive is slow.** Scan in the background, cache results, let the user pick roots.
- **Drives without a Recycle Bin** (USB/network): see §2.2.
- **Cross-machine paths:** settings and shuffle history are per machine, never committed.
- **Thumbnail cache privacy:** needs a "clear cache" button.

## 9. Open questions
1. Old Python code: Lucas will share it later.

## 10. Change Log
- **2026-09-15:** Project started. Wrote initial plan: safety rules, shuffle-bag algorithm,
  phased roadmap, open questions.
- **2026-09-15:** Lucas answered the first questions.
  - Decided: Windows is primary and Mac secondary; top-level files only (subfolders ignored);
    endless unique-cycle shuffle; external player by default, built-in player optional later;
    name doesn't matter.
  - Added the playback/player-control section (§4), stack comparison (§5) and layout sketch (§6).
  - Stack is still pending Lucas's pick.
- **2026-09-15:** Stack decided: **TypeScript + Electron**.
  - mpv is the default player and VLC is an option. A custom built-in player is deferred, not
    dropped.
  - Set up the project with electron-vite (react-ts) and added vitest.
  - Cleaned the packaging config: removed camera/mic prompts, Linux targets, and the auto-update
    URL (the app makes no network calls).
  - `.gitignore` now blocks media, databases, caches, `.env` and `*.local.json`.
  - Found the Node ≥ 22.12 requirement (§5).
- **2026-09-15:** Lucas upgraded Node to 26.8.2.
  - Clean install works without the workaround flag.
  - npm 11 blocked install scripts, so approved electron, esbuild, fsevents and
    electron-winstaller in `allowScripts` (§5).
  - Decided: the GitHub repo will be **public**, created once the shuffler basics work.
  - Background Claude sessions must now work in git worktrees (`.claude/worktrees/`, gitignored)
    and commit on a branch. Lucas merges into `main`.
  - Found by testing a fresh clone: the Electron 39 binary never unpacked on Node 26. The build
    still passed, which hid the problem. Confirmed Node 24 works.
  - Fixed by upgrading to **Electron 44.3.0**. It has no install script and downloads the binary
    on first run, so it was removed from `allowScripts`.
  - Verified on Node 26: clean `npm ci`, type check, build, tests, and a real app launch.
