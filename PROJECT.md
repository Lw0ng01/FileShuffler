# FileShuffler — Project Doc

> Single source of truth for what we're building and why. Update it whenever a major decision or
> change happens (see Change Log at the bottom). `CLAUDE.md` covers *how to work in the code*;
> this file covers *what and why*.

**Status:** v1 features frozen; packaging, measure and harden, and the refactor done; next: the
front end (Resume here) ·
**Stack:** Electron + React + TypeScript (electron-vite) · **Name:** FileShuffler. Lucas doesn't
care about the name; keep it unless they say otherwise.

---

## Resume here

Last updated 2026-09-17, on the Mac laptop, after the long Windows desktop session (2026-09-15 to
09-17). A new session starts without earlier chats or local
memory. This section, the rest of this doc and `CLAUDE.md` (including "Working with Lucas") are the
handoff; keep this section current at the end of each session.

**Start of the next session**
1. `git checkout main && git pull`. Everything through PR #25 is on `main`. One branch is waiting
   for review: `worktree-light-palette`, the lighter light mode logged below.
2. `npm ci`, then `node_modules/.bin/electron --version` (Electron downloads on first run), then
   `npm test`. Expect 301 passing, plus 7 more with `MPV_PATH` set to the machine's mpv.
3. Then start the front end (Next steps below).

**The Mac laptop is set up** (2026-09-17): Node 26.8.2, npm 11.19.1, and mpv 0.41 from Homebrew.
`npm ci`, typecheck, lint and Electron 44.3.0 all work. Lucas ran `npm run dev` and the app opens
and works, so the worker thread, Dashboard, Stats and Settings are confirmed on macOS as well as
Windows. Development data lives in `~/Library/Application Support/FileShuffler Dev`, and each
machine keeps its own index.

**Where things stand**
- The Phase 1 app works on macOS: choose a folder, shuffle, play in mpv with autoplay, Next/Back,
  and Delete with a 5-second undo before trashing. See §2, §3, §4 and §6 (Implementation notes).
- The Windows desktop is set up: Node 24.21, npm 11.19, Git 2.55 and mpv 0.41 from winget
  (§5 Existing setup notes). `npm ci`, typecheck and Electron 44.3.0 work.
- `npm test` runs 301 unit tests. Seven more run against a real mpv when `MPV_PATH` is set, 308 in
  all. All 308 pass on the Mac. **Windows has not been re-run since the drive-grouping change**, so
  that is the first thing to do on the desktop.
- Features are frozen for v1. The agreed order from here is packaging (done, apart from a
  clean-machine test), measure and harden (done, apart from Lucas's USB and clean-machine tests),
  a small refactor (done 2026-09-17: the index runs in a worker thread), then the front end
  (§7 working order).
- Checked on Windows with disposable clips (§2 How delete is implemented, §4 Implementation):
  - mpv's named pipe, loads, end of file, key bindings and unload-until-idle (the real-mpv tests).
  - `shell.trashItem` sent clips to the Recycle Bin on the internal NTFS drive and on an external
    exFAT drive. mpv doesn't lock a file it is playing.
  - Fixed: an unplugged drive looked like a deleted file, because Windows reports both as `ENOENT`.
- Lucas ran the app on Windows (`npm run dev` from Command Prompt). Shuffling a small folder
  worked, and a delete from the app landed in the Recycle Bin (external exFAT drive). Undo, the
  keys inside the mpv window, and a folder of about 1400 videos on that drive all worked too.
- Undo now shows a short note saying what it did, because the toast used to just vanish
  (§6 Implementation). The shuffle was also checked at 1400 videos (§3 Implementation).
- The shuffle survives a restart: the app reopens last time's folder and carries on through the
  same cycle, with a Restart cycle button to reshuffle on demand (§3 and §6 Implementation).
- The dashboard exists: pick folders to index, scan them, and see space by category, drive cards
  with free space, the largest and most recently changed files, and search (§6 Dashboard, §7
  Phase 3 and Phase 4). The indexer behind it is in §7 Phase 3 Implementation.
- A Stats tab shows what the shuffler has played: totals, most played, recently played, never
  played, and a starred favorites list (§6 Stats). Favorites don't affect the shuffle.
- Browsing: search can be narrowed by category, drive and size and sorted by size, date or name,
  and long lists have Show more (§6 Dashboard).
- A Settings tab manages indexed and excluded folders, lets you choose and test mpv, and clears
  play history, favorites, shuffle progress or the index (§6 Settings).
- Front-end feedback waiting for the design pass: Cleanup should be its own tab rather than a
  section at the bottom of the dashboard, which took scrolling to find (Lucas, 2026-09-16).
- The old Python shuffler was reviewed. It confirms §3's guess about why it felt bad.
- Public repo: https://github.com/Lw0ng01/FileShuffler.
- Commits use GitHub's private email. In a new clone, run
  `git config user.email "71304042+Lw0ng01@users.noreply.github.com"` before committing. Never
  commit personal emails or local paths.
- Measure and harden so far: scans and the index were measured and sped up, the packaged app has a
  startup and memory baseline, and startup survives a damaged index or a second launch (§5
  Measurements, §10). Lucas confirmed the merged features work (2026-09-16).

**Next steps, in order**
1. The front end (§7 working order): structure first, then visual polish. Lucas chose to run this
   and the custom-player question (§4, §9 item 5) in parallel, because mpv's own window is what he
   finds ugly and polish in the app's own screens cannot fix that.
   - Done: Cleanup is its own tab (`components/CleanupScreen.tsx`), and the front-end conventions
     live in the `fileshuffler-ui` skill (`.claude/skills/fileshuffler-ui/SKILL.md`).
   - Still to do: starring from the dashboard's lists, and a first-run guide when mpv is missing
     (pointing to Settings). Then visual polish, once the motion values are agreed.
   - Ask Lucas before settling layout or look: the front end is where his taste decides. The skill
     labels unsettled things "Open" for exactly this reason.
2. Whenever convenient, Lucas, on the Windows desktop: try a delete where recycling isn't supported, on a removable USB
   stick or a network share. It must fail with an error and keep the file, never delete
   permanently. His external drive doesn't count: Windows treats it as a local disk and it has a
   Recycle Bin.
3. Whenever convenient, Lucas, on the Windows desktop: build the installer (`npm run build:win`)
   and install it from a separate local Windows account with no development tools, as the
   clean-machine test (§7 Phase 6). Copy it to `C:\Users\Public` first so the other account can
   reach it.
4. Before any public release: choose a license (§9), and decide whether the unsigned-installer
   SmartScreen warning is acceptable.

**How it was tested without real videos**
- mpv can generate test clips, for example
  `mpv --no-config "av://lavfi:testsrc2=duration=30:size=320x180:rate=15" --o=clip.mkv`.
- On macOS the screen was checked with a throwaway Electron script that was not committed; recreate
  it if needed.
  - It replaced `dialog.showOpenDialog` with a stand-in, clicked through the UI with
    `webContents.executeJavaScript`, and saved screenshots with `capturePage()`.
  - Every delete was undone, so nothing reached the Trash.
- On Windows a second throwaway Electron script (also not committed) played a copied clip in mpv
  over a named pipe (`--vo=null --ao=null`), tried a rename and `shell.trashItem` while it played,
  and trashed a clip on the external drive. Both clips were then found in the Recycle Bin.
- Not yet exercised on Windows: drives that can't recycle (a removable USB stick or a network
  share).

**Open decisions and known quirks**
- ~~The intermittent real-mpv test~~: explained and fixed 2026-09-17. Its `waitFor` helper gave up
  after 8 s inside a suite that declares 20 s, so a one-second clip could miss its own deadline in a
  full parallel run. It now allows 15 s. Not proven beyond doubt, because no failing run was ever
  captured with the raw mpv events logged: if it comes back, instrument the adapter rather than
  raising the number again.
- mpv is not bundled; people install it (§7 Phase 6 spike findings). Whether to build a custom
  player instead is open (§4 Embedded player).
- A video restored with Undo doesn't reappear in "Recently played" (cosmetic).
- npm 11 runs install scripts only for packages approved in `allowScripts` (§5).
- winget's mpv isn't added to the PATH on its own (§5 Existing setup notes). Choosing it in
  Settings avoids the PATH entirely.
- In PowerShell, `npm run dev` fails by default; use Command Prompt or `npm.cmd run dev` (§5).
- Saved cycle progress lives in the app's data folder (`progress.json`). Deleting it only means
  cycles start fresh.
- The installed app keeps its data in `%APPDATA%\FileShuffler` and development runs in
  `%APPDATA%\FileShuffler Dev` *(Lucas, 2026-09-16)*, so experiments never touch a real library.
  Before that was pinned, both used `file-shuffler`; the first development run copies FileShuffler's
  own files from there and leaves the old folder as a backup (§7 Phase 6 spike).

---

## 1. Vision

A small personal desktop app with two parts:

1. **Shuffler (the core):** point it at a folder of videos and play them in a *good* random order.
   Buttons for next, back and delete (sends the file to the Recycle Bin/Trash).
   Remake of an older Python app whose shuffle felt bad.
2. **Dashboard (planned, after the shuffler):** a good-looking overview of the *personal* files
   in selected locations across drives: videos, pictures, documents, audio. System and background
   files are left out.
3. **Custom built-in player (planned):** a player integrated into the dashboard, with our own
   controls and a native media engine for broad video/audio/subtitle support. External mpv gets
   the shuffler working first; embedded playback has an early feasibility milestone (§4).

All three parts matter to Lucas. The shuffler is the first delivery priority. The project should
also demonstrate good system architecture, design, and measured efficiency. Keep the design
small enough to finish, and **never introduce a permanent-delete path.**

**Platforms:** Windows is the main target (Lucas's desktop). macOS is a nice-to-have (laptop).

**Who it is for:** Lucas first, but the plan *(decided 2026-09-15)* is a public download on GitHub
that other people can install and use. That raises the bar beyond "works on Lucas's machine":
someone else's drives, no mpv installed, no development tools, and no way to ask us what went
wrong. Error messages, the first run and the installer all have to stand on their own (§7 Phase 6).

## 2. Non-negotiable safety rules

1. **Read-only by default.** Scanning only reads metadata (name, size, dates). It never modifies,
   moves or renames anything.
2. **The only destructive action is "move to Recycle Bin/Trash".** No permanent delete anywhere
   in the codebase. If the OS can't send a file to the trash, **fail and show an error** instead of
   falling back to a permanent delete.
   - Some removable and network locations do not support recycling. Disable the action where
     this is known; otherwise report a failed trash operation. Extra confirmation never permits
     permanent deletion. Test actual behavior on the target Windows storage types.
   - ⚠️ Windows locks files that are open in some programs. **Switch the player to the next
     video (or unload the file) before trashing it** (see §4). mpv itself holds no such lock: on
     Windows a file it was playing could be renamed and trashed (checked 2026-09-15). Other
     players such as VLC may lock, and unloading first means a file is never trashed mid-playback.
3. **Undo window for delete.** Delete hides the file right away but only sends it to the trash
   after about 5 seconds, so it can be undone in the app. Cancel actions still in the undo window
   when the app closes; do not replay them after a restart. An OS trash operation already started
   cannot be cancelled by this undo mechanism. On failure, restore the item in the app and show
   the error. Recheck the target before acting; if the file changed or its identity is uncertain,
   cancel the action instead of trashing a replacement at the same path.
4. **Allowlist, not blocklist, for file types.** Only index known personal-media and document
   extensions.
5. **Skip system locations:** `C:\Windows`, `Program Files*`, `ProgramData`, `AppData`,
   `$Recycle.Bin`, `System Volume Information`, `/System`, `/Library`, `~/Library`,
   `/Applications`, hidden/dot folders, `node_modules`, `.git`.
   - Program installs are skipped **on any drive**, not just the system drive: `Program Files`,
     `Program Files (x86)`, `WindowsApps`, `steamapps`. So are developer tool folders:
     `site-packages`, `__pycache__`, and any folder containing `pyvenv.cfg` (a Python virtual
     environment). Measured reasons in §5 Measurements.
   - Game folders with arbitrary names (for example `Riot Games`) can't be recognised by name, so
     Settings has **Excluded folders** for them (§6 Settings). Excluding removes index entries only,
     never files.
6. **Don't follow symlinks or junctions.** Windows AppData junctions can cause infinite loops.
7. **Fully local.** No network calls, no telemetry. Thumbnail and index caches stay on the machine
   and can be cleared from settings. (Talking to a local player over its local control channel is
   fine.)
8. **Nothing personal goes into git:** no media, caches, index database, or config holding real
   paths. Enforce this with `.gitignore`.

### How delete is implemented (Phase 1)

- **Entry points:** `ShuffleCoordinator.deleteCurrent()` and `undoDelete(id)` in
  `src/main/app/coordinator.ts`. `DEL` inside mpv goes through the same path.
- **Immediately:** the file is hidden from the session and playback moves on. It is listed in
  `pendingDeletes` with a deadline, so the UI can show a countdown and an Undo button.
- **When the 5-second window ends:**
  1. Wait until the player has moved past the file: any event for a newer load, or the player
     stopped or exited. If it hasn't, check again every second for up to 10 seconds, then keep
     the file.
  2. Read the file's identity again with `lstat`, without following links: device, file ID, size
     and nanosecond modification time.
  3. If it's gone, just remove it from the session. If it changed or can't be read, keep it and show
     why. If it's the same file, call `shell.trashItem`.
     - "Gone" means the file is missing but its folder is still there. Windows reports a missing
       folder or drive (an unplugged USB drive) as `ENOENT` too, so without that check an unplugged
       drive would look like a deleted file and be dropped from the session.
  4. If trashing fails, keep the file and show the error. There is no fallback of any kind.
- **On close:** deletes still in the undo window are cancelled and never replayed. A trash
  operation that already started finishes.
- **Electron on Windows**, checked in its source (`shell/common/platform_util_win.cc`):
  - `trashItem` uses `IFileOperation` with `FOFX_RECYCLEONDELETE`.
  - Its progress handler aborts (`E_ABORT`) whenever Windows says an item can't be recycled, so the
    promise rejects instead of deleting permanently.
  - Checked on the Windows desktop (2026-09-15): clips on the internal NTFS drive and on an
    external exFAT drive (which Windows lists as a local disk) went to the Recycle Bin.
  - Still to confirm on a removable USB stick and a network share, where recycling isn't supported.
- **Folder reading:** `listVideoFiles` in `src/main/files/videoFolder.ts`.
  - Top level only, regular files only.
  - Skips links, junctions and dot-files.
  - Extensions come from an allowlist. `.ts` and `.mts` are excluded because they are also
    TypeScript source files.
- **Known limits:**
  - The Windows "hidden" attribute isn't checked, only dot-files.
  - FAT-formatted drives may not report stable file IDs; size and modification time still apply.
    The external exFAT drive on the Windows desktop did report stable IDs that change when a copy
    replaces the file.

## 3. The shuffle algorithm (the main thing to get right)

### Scope of a shuffle session

- **Top level only.** Only video files directly inside the chosen folder are included.
  **Subfolders are ignored entirely** (not scanned, not played, never touched). *(Decided 2026-09-15.)*

### Why the old one felt bad

Lucas's old app (`fileshuffle.py`: customtkinter, packaged with PyInstaller as VideoCurator) was
reviewed on 2026-09-15. It confirms the first guess:
- **Every Next called `random.choice(pool)`** (sampling *with replacement*), so videos repeat
  quickly, sometimes twice in a row. With 100 videos there's about a 50% chance of a repeat within
  the first 12 picks (the birthday problem).
- **No history**, so there was no Back.
- It also scanned subfolders recursively, opened each video in the default player with
  `os.startfile` (which it couldn't control or close), and deleted permanently with `os.remove`
  after a yes/no prompt, with no undo.
- Another common shortcut, `array.sort(() => Math.random() - 0.5)`, is biased too: it doesn't
  produce a uniform shuffle. The old app didn't use it.

### The design: shuffle bag + playlist history

- **Fisher–Yates shuffle** gives a uniform base permutation. Automatic forward traversal
  covers each eligible file once per cycle. Explicit Back/Forward navigation can replay history;
  this does not consume the shuffle bag again.
- **One `playlist` array plus a `cursor`** handles navigation:
  - *Next:* `cursor + 1`. If that's past the end, pull the next file from the bag.
  - *Back:* `cursor - 1`. Pressing Next after Back replays the same order, like a browser's
    forward and back.
- **Endless, maximum-coverage cycles** *(decided)*: when the bag runs out, reshuffle and keep
  going. For an unchanged eligible set of size n, use K = min(10, floor(n / 3)): exclude the
  previous cycle's last K files from the next cycle's first K positions. Also avoid an immediate
  repeat when n > 1, even if K is zero. Handle changed/empty/single-file sets explicitly; relax
  exclusions only when they cannot be satisfied, and never retry indefinitely. These constraints
  intentionally alter uniform randomness.
- **Delete:** temporarily exclude the item during its undo window while preserving enough state
  to restore it. Only finalize removal after successful trashing; maintain a valid history cursor.
- **Progress:** label a file "opened this cycle" only after the player reports a successful load.
  This is coverage, not proof it was watched. Failed/missing files are reported separately and
  skipped for this cycle; stop autoplay when no playable candidates remain instead of looping.
- **History:** bound navigation history in memory. Preserve current-cycle coverage independently
  so trimming old history does not reintroduce already-opened files into the current cycle.
- **New files found mid-session:** insert them at a random spot in the *unplayed* part of the bag.
- **Persist per folder:** save which files have been played this cycle, so reopening the app
  continues the cycle instead of starting fresh. This matters because the goal is coverage.

### Implementation (Phase 1)

The engine lives in `src/main/domain/shuffle.ts` (`ShuffleSession`), with tests beside it. It is
pure TypeScript: items are opaque string IDs, and randomness is injected.
- **API:** `next()`, `back()`, `current()`, `markOpened(id)`, `markFailed(id)`,
  `beginDelete(id)` / `cancelDelete(id)` / `completeDelete(id)`, `add(ids)`, `stats()`,
  `snapshot()`, `restartCycle()`.
- **Choices the spec left open:**
  - `markOpened` counts only items drawn in the current cycle. Replaying a previous cycle's item
    with Back does not add coverage.
  - Failed items are skipped for the rest of the cycle and retried next cycle. A new cycle starts
    only if at least one available item hasn't failed; otherwise `next()` returns null.
  - Items in a pending delete stay in the cycle but are skipped. If the cycle ends first, they
    carry into the next cycle.
  - The seam rule uses constructive swaps with no retry loop. Known limitation: if items at the
    start of a new cycle are skipped (failed or pending), later draws can reach a protected item
    within the first K plays.
  - History keeps 500 entries by default.
- **Tests prove, without statistics:** the shuffle maps every sequence of random choices to a
  distinct order (unbiased), the seam rule across 200 seeds and several folder sizes, coverage over
  4 cycles, Back/Forward, failures, the delete/undo lifecycle, added files and the history limit.
  A mutation check confirmed the tests fail for a disabled seam rule and for Next that doesn't
  replay history. A sort-based shuffle is also rejected, but because it doesn't make exactly one
  random choice per step (the scripted source runs out), not because the test measures its bias.
- **Checked at Lucas's folder size** (2026-09-15, throwaway simulation of this engine with 1400
  items and `Math.random`, not committed; 18 of 18 checks passed):
  - 5 full cycles played all 1400 videos exactly once each, with no back-to-back repeat in 7000
    plays and no overlap between a cycle's last 10 and the next cycle's first 10.
  - Over 2000 cycle changes the closest two plays of one video were 11 apart. Per cycle change
    about 0.8 / 3.5 / 14 videos return within 50 / 100 / 200 plays. Lucas reviewed these numbers
    and decided to keep K as it is rather than widen the seam for large folders (2026-09-15).
  - Every video was equally likely to play first and to land anywhere in the cycle, and play order
    had no link to alphabetical (folder) order, so numbered episodes don't drift into sequence.
  - Back/Next replay, the 500-entry history limit, and delete/undo mid-cycle all behaved.
- **Saved between launches** (2026-09-15, Phase 2): `snapshot()` and the `restore` option carry a
  cycle across restarts — the cycle number, the bag still to be drawn, this cycle's draws and what
  the player confirmed opening. Failed items and Back/Forward history are deliberately left out: a
  failure is worth retrying next launch, and replaying an old run's history would make Back
  confusing.
  - A restored snapshot is reconciled with the folder as it is now. Videos deleted elsewhere drop
    out, duplicates are ignored, and files added while the app was closed join the unplayed part at
    a random position, exactly as they would mid-session.
  - `ProgressStore` (`src/main/files/progressStore.ts`) keeps one JSON file in the app's own data
    folder, writing a temporary file and renaming it so a crash can't leave half a file. A missing
    or corrupt file reads as "no progress" instead of blocking startup, and only the 20 most recent
    folders are kept. Nothing here writes to the user's own files.
  - **Data folder:** pinned in `src/main/index.ts` (`dataFolderName`): `FileShuffler` for the
    installed app, `FileShuffler Dev` for development. Electron would otherwise name it after
    `package.json` (`file-shuffler`) for *both*. An earlier note here said the packaged build used a
    different folder; the packaging spike showed that was wrong. Renaming it again later would
    silently abandon everyone's saved cycles, so treat the name as fixed.
- **Restart cycle** *(Lucas asked for this alongside the memory, 2026-09-15)*: `restartCycle()`
  reshuffles everything and starts a new cycle, so a remembered cycle can always be abandoned. It
  reuses the normal new-cycle path, so the seam rule still prevents an immediate repeat.

### Possible upgrades (later)

- **Weighting:** favor favorites or videos not seen in a long time, without breaking the
  no-repeat guarantee.
- Test pure shuffle logic with an injectable random source: coverage, small/empty folders,
  cycle boundaries, Back/Forward, and undo/delete while navigating history. Use deterministic
  invariant tests; a flaky statistical test is not proof of uniformity.

## 4. Playback: external mpv first, embedded native player planned

### First release: one bundled player

Use a persistent mpv process controlled over local JSON IPC (named pipe on Windows, Unix socket
on macOS). Load files into that process instead of restarting it on every Next. Phase 1 ships
only mpv.

**VLC is the planned second player (Phase 2)**, because Lucas wants it as an option.
- Implement mpv behind a small playback adapter interface whose shape also fits VLC: load and
  unload a file, report a successful load, end of file, errors and player exit.
- VLC is user-installed and controlled through its local interface (HTTP bound to localhost, with a
  password). It reports state by polling rather than pushed events, so the adapter must not assume
  push events.
- Don't build VLC support in Phase 1, but don't design it out either.
- IINA and generic players stay deferred until there is a concrete need.

For every player:
- Keep shuffle order and navigation authoritative in the application. Route player key bindings
  into the same application actions so mpv and the dashboard cannot advance separate playlists.
- Prefer bindings inside the mpv window for fullscreen control. Make system-wide shortcuts
  optional/configurable and avoid claiming plain arrow/Delete keys globally.
- Serialize playback transitions and associate events with the active load request. Rapid Next,
  EOF, Back, and Delete must not advance twice or let late events overwrite newer state.
- Before trashing, unload the target and wait for the relevant playback transition to complete.
  A command being sent is not proof that a file handle was released. If trashing still fails,
  restore the item and report the error; never force deletion.
- Handle process exit, load errors, and IPC disconnects explicitly. Keep IPC local with suitable
  access restrictions; pass commands as structured data, not interpolated shell strings.

### Implementation (Phase 1)

- **Player interface:** `src/main/playback/types.ts`.
  - `load()` returns a token immediately.
  - Events: `loaded`, `ended` and `failed` (each with its token), `command`
    (`next`/`back`/`delete`) and `exited`.
  - Nothing assumes pushed events, so a polling VLC adapter fits.
- **Coordinator:** `src/main/app/coordinator.ts` connects `ShuffleSession` to a player.
  - Ignores any event whose token isn't the active load.
  - Counts coverage on `loaded`, autoplays on `ended`, and skips and reports `failed` files.
  - Stops (`finished`) when nothing can play.
  - Ignores commands once the player exits, rather than silently restarting it.
- **mpv adapter:** `src/main/playback/mpv/` (`MpvIpcClient`, `MpvPlayer`, `launchMpv`).
  - One mpv process per session, started without a shell. The IPC socket lives in a private temp
    directory (a random named pipe on Windows).
  - Flags: `--no-config`, because user scripts such as autoload would play files outside the
    session; plus `--idle=yes`, `--force-window=yes`, `--keep-open=no` and `--ytdl=no`.
  - Keys inside mpv: `>` for Next and `<` for Back. These are mpv's own playlist keys, so
    arrow-key seeking still works. `DEL` deletes (fn+Delete on a Mac). They arrive as
    `client-message` events, so no Lua script is needed. Lucas left the key choice to Claude
    (2026-09-15); the arrow keys stay for seeking within a video.
  - Each load is matched to the `playlist_entry_id` in mpv's `loadfile` reply. Events that
    arrive before the reply are buffered, because mpv's docs don't guarantee the order.
  - `unload()` sends `stop` and then waits until `idle-active` is true, because `stop` replies
    before the file is released.
  - `dispose()` sends `quit`, force-stops mpv after 3 seconds, and removes the temp directory.
- **Verified against mpv 0.41.0** (official macOS build), with a recorded protocol probe and
  integration tests:
  - A missing file ends with `end-file` reason `error`.
  - A normal file sends `file-loaded`, then `end-file` reason `eof`.
  - With back-to-back loads, the replaced file ends with `stop`.
  - Key bindings arrive as `client-message`.
  - The integration tests run when `MPV_PATH` is set.
- **Verified on Windows** (2026-09-15, mpv v0.41.0-244, shinchiro build from winget):
  - All 6 integration tests pass over the named pipe.
  - A probe with a copied clip showed mpv doesn't lock a file it is playing: a rename and
    `trashItem` both succeed. Trashing after `idle-active` therefore works too.
- **Still to verify on Windows:** keys pressed in a real mpv window (the tests send `keypress`
  over IPC), and the bundled mpv build.
- **Where mpv comes from, decided 2026-09-16:** not bundled. People install it and Settings finds
  or chooses it (§6 Settings, §7 Phase 6 spike findings). Lucas finds mpv's window unattractive,
  which adds weight to the embedded-player milestone below.

### Embedded player: an early feasibility milestone

"Built-in native player" means our own integrated interface backed by a native media library
such as libmpv or libVLC. It does not require writing codecs from scratch. HTML video previews
can be useful, but do not satisfy the broad-format player goal by themselves.

Immediately after the first working shuffler flow, before extensive dashboard layout work,
prototype one embedded playback surface on Windows. Test:
- Video actually inside the app, with custom controls, correct layering, resizing, fullscreen,
  focus, keyboard input, display scaling, and clean teardown/file release.
- Representative containers/codecs, audio/subtitle tracks, seeking, and hardware decoding where
  the machine supports it. Broad support is a tested compatibility matrix, not "every format".
- CPU, memory, dropped frames, and seek responsiveness against external mpv with the same files
  and settings. Keep decoded video frames out of the normal JavaScript/JSON message channel.
- A packaged Windows build on a machine without development tools. Assess macOS feasibility
  before promising equivalent embedded behavior there.

Record the rendering approach, dependencies, measurements, limitations, and integration effort.
A playback interface can preserve application logic across external and embedded implementations;
it cannot make native rendering, packaging, and window integration disappear.

If the prototype meets the agreed criteria, implement it in Electron. If it exposes a material
limitation, compare a focused Qt or .NET prototype (or Tauri when appropriate) before migrating.
Do not assume any framework makes native media embedding effortless.

## 5. Tech stack: ✅ decided: TypeScript + Electron

**Current choice:** Electron + React + TypeScript, scaffolded with electron-vite, tests with
vitest. Keep this stack for the shuffler and initial dashboard work. This is a practical fit for
Lucas's goals and existing start, not a claim that Electron is universally best or most efficient.
- **First player:** bundled external mpv only.
- **Second player:** VLC as an option (Phase 2), through the same playback adapter (§4).
- **Planned player:** custom embedded native playback, subject to the early prototype in §4.
- **Learning objective:** explain architecture, state transitions, performance measurements,
  failure handling, and tradeoffs. A harder language is not automatically a better portfolio.

### Existing setup notes

Verified 2026-09-15 on `main` after the Electron 44 merge: Node 26.8.2, npm 11.19.1, Electron
44.3.0, approved install scripts, clean install, build and app launch. Re-check after any
toolchain upgrade.

Windows desktop, set up 2026-09-15: Node 24.21.0, npm 11.19.0, Git 2.55.0, Electron 44.3.0
(downloaded on first run) and mpv v0.41.0-244. Clean `npm ci`, typecheck and tests pass.
- **mpv from winget** (`winget install shinchiro.mpv`) installs to `C:\Program Files\MPV Player`
  but doesn't add it to the PATH. Add that folder to the user PATH, or set `FILESHUFFLER_MPV`.
  The installer is a community repackaging of shinchiro's builds; winget verifies its hash.
- **Git for Windows defaults to `core.autocrlf=true`.** Files were checked out with CRLF and
  Prettier flagged about 4,000 lines. `.gitattributes` now keeps LF on every platform.
- **PowerShell can't run `npm` out of the box.** In PowerShell `npm` is a script (`npm.ps1`), and
  Windows 11 Home's default execution policy (Restricted) blocks scripts. Use Command Prompt or
  `npm.cmd run dev`, or allow local scripts once with
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. A terminal opened before installing Node
  also keeps the old PATH, so open a new one afterwards.

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

### Index store: Node's built-in SQLite ✅ decided 2026-09-16

The indexer stores what it finds through `node:sqlite`, the SQLite built into Node itself.
- Checked before choosing: Electron 44.3.0 runs Node 24.20, and a real insert and read worked
  inside Electron, not just in plain Node.
- It avoids a native dependency such as `better-sqlite3`, which would need rebuilding for every
  Electron upgrade, another entry in `allowScripts`, and a working toolchain on every machine that
  builds the app.
- The store sits behind `IndexDb` (`src/main/library/indexDb.ts`), so swapping the engine later is
  a contained change rather than a rewrite.
- The database lives in the app's data folder beside the shuffler's progress, never with the user's
  files (§2.8).

### Tradeoffs and criteria for reconsidering the stack

| Option | Relevant benefit | Cost / uncertainty |
|---|---|---|
| Electron + TypeScript + mpv | Shared language for UI/application logic; consistent browser engine; fits the shuffler and dashboard | Chromium/Node baseline overhead; embedded native rendering needs a prototype |
| Tauri + TypeScript/Rust + native media engine | Reuses web UI and avoids bundling a full browser engine | Adds Rust and migration work; native video integration still needs proof |
| Qt + native media engine | Worth evaluating for a player-centered native desktop design | UI rewrite and toolkit/language learning; rendering and packaging still require work |
| .NET desktop UI + native media engine | Worth evaluating for the Windows-first target | New stack; verify the chosen UI toolkit's embedding and macOS path |

Tauri's system webviews differ between platforms, but that does not limit an external mpv
process's codec support. Package sizes must be measured with equivalent bundled dependencies;
previous rough size comparisons are not decision evidence.

Electron is not a guarantee of low memory, low CPU, or easy embedding. Switching the app shell
also does not automatically improve native video decoding. Reconsider the stack when measured
resource use or the player prototype misses a concrete requirement, or if Lucas explicitly
changes the learning goal. Do not migrate for framework reputation alone.

### Architecture: clear boundaries inside one desktop application

These are target responsibilities, not a claim that these modules already exist. Introduce them
as features arrive; avoid a generic plugin framework or services that the MVP does not need.

| Layer | Owns | Boundary |
|---|---|---|
| React renderer | Dashboard/shuffler views, input, display state | No direct filesystem, shell, database, or player process access |
| Preload bridge | Narrow, typed operations and event subscriptions | Validate inputs at the privileged receiving side; never expose arbitrary IPC or shell execution |
| Application coordinator | Shuffle session, navigation, pending trash, playback transitions | One authority for commands/events; explicit states and errors |
| Pure domain logic | Shuffle bag, cycle coverage, history rules | No React, Electron, filesystem, or player dependency |
| Adapters | mpv control, OS trash, folder reads, later storage/indexing | Small interfaces; real platform behavior tested separately |
| Background work | The index database (a worker thread since 2026-09-17); later probing, thumbnails, CPU-heavy tasks | Bounded concurrency, cancellation, progress, and cleanup |

Keep context isolation and renderer sandboxing enabled, Node integration disabled, and a
restrictive content security policy. Validate IPC senders and requests. Resolve file actions
against the active session rather than accepting unrestricted paths from renderer input.

Use asynchronous filesystem operations; move CPU-heavy work off the main/UI threads when it
arrives. Add SQLite with the indexer, not as a requirement for the initial shuffle algorithm.
Persist per-folder progress separately from the UI and recover safely from invalid saved state.

### Efficiency: measure the whole application

- Measure a packaged release build on the Windows desktop, with hardware, sample files,
  library size, and playback settings recorded. Development builds are not the baseline.
- Record cold launch to interactive, idle memory/CPU, playback memory/CPU, dropped frames,
  seek latency, and responsiveness while scanning. Account for all Electron and player/helper
  processes; use consistent memory metrics and distinguish OS cache from process memory.
- Start with a baseline after the first usable flow. Then set explicit budgets for the target
  machine and use the same scenario to compare changes; no performance claims without results.
- Exercise repeated Next/Back/load/unload operations. Check that memory and handle counts settle
  after warm-up and that listeners, child processes, timers, and caches are cleaned up.
- Later: render only visible rows in large lists, cache thumbnails with limits, limit indexing
  concurrency, and provide cancellation. Pause unnecessary dashboard work during playback.
- Keep short design notes explaining the chosen tradeoffs, including the native-player prototype.
  Architecture is demonstrated through behavior, tests, and measured results, not folder count.

### Measurements (2026-09-16, measure and harden)

The scan and index numbers come from plain Node against the real scanner and index store. Speed
transfers to the app; memory does not (the benchmarks hold their test data), which is why the
packaged app was measured separately (below).

**Real drives, read-only scans** (Lucas's PC; totals only were recorded):
- External drive F: 10 folders, 1,928 files (847 GB) in 0.9 s.
- Second drive D: 6,306 folders in 1.4 s, about 4,400 folders a second. **99% of those folders were
  program and game installs** (`Program Files (x86)`, `Program Files`, two game folders): adding D:
  would have indexed about 20,000 game and program files (66 GB) as personal media.
- User profile: 9,197 folders in 1.8 s. **82% were Python libraries** inside 24 virtual environments
  under Documents.
- Scanning is not the bottleneck; what gets scanned was. Both findings changed the skip rules (§2.5).

**Synthetic libraries** (realistic names, duplicates, folders and sizes), before → after the changes:

| | 250,000 before | 250,000 after | 1,000,000 before | 1,000,000 after |
|---|---|---|---|---|
| First full index | 37.4 s | 14.9 s | 213 s | 125 s |
| Rescan, 1% gone | 28.4 s | 1.9 s | 146 s | 8.6 s |
| Duplicate candidates | 1,391 ms | 36 ms | 4,419 ms | 176 ms |
| Name search, page 3 | 103 ms | 45 ms | 380 ms | 259 ms |
| Totals by category + drive | 229 ms | 126 ms, cached | 812 ms | 927 ms, cached |
| Biggest folders | 158 ms | 172 ms | 614 ms | 930 ms |
| Database size | 79 MB | 88 MB | 306 MB | 349 MB |

What changed, each chosen by comparing variants on the same 250,000-file library:
- A 64 MB SQLite page cache, in-memory temporary tables, and scanner batches of 2,000 instead of
  500: first index 30 s → 12 s, rescan 19 s → 10 s.
- A `(name, size)` index for duplicates, plus an upsert that rewrites a file only when it changed
  and otherwise just marks it seen. Indexes alone made rescans *slower* (four indexes: 33 s),
  because rewriting every column rewrites every index entry; leaving unchanged rows alone took the
  rescan to 2 s. A `folder` index for biggest folders didn't help and was left out.
- **Totals are cached.** Views are built every 200 ms during a scan, and recomputing category and
  drive totals took about 120 ms of each 200 ms on 250,000 files, on the main process. They are now
  recomputed only when the index changes.

**Packaged app baseline** (`npm run build:unpack`, Ryzen 7 7700, 32 GB, NVMe; the window is shown
at `ready-to-show`, memory read 10 s after it appears, summed over all four Electron processes):

| Launch | Window visible | Working set | Private memory |
|---|---|---|---|
| First run, no data | 824 ms | 304 MB | 187 MB |
| Warm start (three runs) | 317–333 ms | 302–303 MB | 188 MB |
| Warm start with Lucas's real 8.7 MB index (two runs) | 290–333 ms | 302–305 MB | 189 MB |

- Idle memory is Electron's floor: the index size made no measurable difference at this size.
- The first run's extra half second is Chromium building its caches in a new data folder.
- Proposed budgets to hold from here: window visible under 1 s on a warm start, idle private
  memory under 250 MB. Not yet measured: memory during a long scan and during playback (mpv is its
  own process), and a machine slower than this one.

**Database work moved off the main process** (refactor, 2026-09-17). SQLite is synchronous, so
every query used to hold Electron's main process, which also drives the window. The index now
lives in a worker thread. Measured in plain Node on a synthetic 1,000,000-file index, running the
dashboard's heavy reads (category and drive totals, biggest folders, duplicates, a name search,
never played), and timing the longest gap in a 5 ms timer on the calling thread:

| Three rounds | On the main thread | Through the worker |
|---|---|---|
| Longest stall | 3,059–3,242 ms | 18–22 ms |
| Time for the queries themselves | 3,059–3,242 ms | 2,952–3,233 ms |

- The queries take as long as before; the difference is that the window keeps responding while
  they run.
- Packaged app after the change, warm starts with Lucas's real index: window visible after
  302–350 ms (first launch after a rebuild: 898 ms), idle private memory 210–223 MB, up from
  188 MB. The worker thread's own JavaScript engine and SQLite cache account for that; still under
  the proposed 250 MB budget. A normal close takes about 130 ms, index closed cleanly.

**Still to address:**
- Not yet tested: a delete on a removable USB stick or network share, and a clean machine.
- Queries at a million files still take seconds in total, even though the window stays
  responsive. If that matters in practice, the next step is per-query work (for example keeping
  running totals rather than summing), measured first.

References for implementation and review:
- [Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron trash API](https://www.electronjs.org/docs/latest/api/shell#shelltrashitempath)
- [mpv JSON IPC](https://mpv.io/manual/master/#json-ipc)
- [mpv embedding examples](https://github.com/mpv-player/mpv-examples)
- [Tauri webviews](https://v2.tauri.app/reference/webview-versions/)

## 6. Layout

Build the shuffler first, inside an app shell with a sidebar, so the dashboard slots in later.

```
┌──────────┬──────────────────────────────────────────────┐
│ ▶ Shuffle│  📁 D:\Videos\Clips            [Change]      │
│ ▦ Dash   │                                              │
│ ⚙ Setting│   Now playing: some_clip.mkv                 │
│          │   Cycle 2 · 140 / 340 opened                 │
│          │                                              │
│          │     [ ◀ Back ]  [ ⤮ Next ]  [ 🗑 Delete ]     │
│          │   Player: mpv · shortcuts in player          │
│          │                                              │
│          │   Recent:  clip_a.mp4 · clip_b.mkv · …       │
└──────────┴──────────────────────────────────────────────┘
```

### Implementation (Phase 1)

- **Screen** (`src/renderer/src/`): a sidebar (Shuffle active; Dashboard and Settings marked
  "Soon") and one shuffler screen.
  - **Folder bar:** shows the shortened path, with the full path in a tooltip, and a Change button.
    Change is disabled while a delete can still be undone.
  - **Card by state:** pick a folder, empty folder, ready (N videos, Start shuffle), starting mpv,
    now playing (name and cycle progress), finished, or player closed (Reopen player).
  - **Controls:** Back / Next / Delete appear only once something has played, so the ready card's
    Start shuffle is the single main action.
  - **Feedback:** an undo toast with a live countdown per pending delete, an error banner, a short
    note confirming what an Undo did (it clears itself), key reminders, and a recently played list.
  - **Restart cycle:** a button beside the progress bar. It asks to confirm first, because
    restarting throws away this cycle's coverage.
  - **In-app keys** (only while the window has focus, never global): → / ← next and back, Delete or
    ⌘/Ctrl+Backspace to delete, ⌘/Ctrl+Z to undo the latest delete.
  - Dark theme with a light variant that follows the system setting. System fonts only, so there
    are no network requests.
- **Main process:**
  - `ShufflerService` (`src/main/app/shufflerService.ts`) owns one folder session at a time.
  - It starts mpv on the first Play, only once even if Play is clicked twice. It reopens mpv at the
    same file after its window is closed, or moves on if Next is pressed.
  - It turns a missing mpv into a readable message and refuses to change folders while a delete
    can be undone. Closing the app disposes it, which cancels pending deletes.
  - Progress is saved about a second after the last change (so a burst of Next presses writes once)
    and again when the app closes. `restoreLastSession()` reopens last time's folder at startup,
    ready to play; an unreadable folder, for example on an unplugged drive, is skipped in silence.
- **Bridge:** `src/preload/index.ts` exposes `window.api.shuffler` with one fixed channel per
  command (`src/shared/shuffler.ts`).
  - `src/main/ipc.ts` rejects any caller other than the app window's top-level frame.
  - It checks arguments at runtime. The renderer never sends paths; Undo accepts only a name string.
  - `undoDelete` answers `restored`, `trashing` or `unknown`, so the screen can confirm what
    happened instead of the toast just vanishing.
- **Finding mpv** (`findMpv.ts`), in order: `FILESHUFFLER_MPV`, `resources/mpv/` in a packaged app,
  common macOS install paths (apps opened from Finder don't get the shell PATH), then `mpv` on the
  PATH.
- **Verified on macOS** with a throwaway launch script: the built app, a stand-in for the native
  folder picker, 30-second generated clips, and real mpv 0.41.0. 21 of 21 checks passed:
  - Choosing a folder counted only the 5 top-level videos.
  - Start, Next, Back and replaying with Next worked, along with progress and the recently played
    list.
  - Delete showed a toast with a countdown and disabled Change; Undo restored the video.
  - The → key worked.
  - The test folder was untouched, and mpv closed when the app quit.
- **Run on Windows** by Lucas (2026-09-15, `npm run dev` from Command Prompt): shuffling a small
  folder worked, and a delete from the app landed in the Recycle Bin (external exFAT drive). A
  later pass covered Undo, the keys inside the mpv window, and a folder of about 1400 videos.
- **Not yet:** a delete from the UI on a drive that can't recycle (§2.2).

### Dashboard (Phase 4, first pass)

The sidebar now switches between Shuffle and Dashboard; Settings stays for later, because the
folders to index are chosen on the dashboard itself.

- **Screen** (`src/renderer/src/components/DashboardScreen.tsx`), reading `useLibrary`:
  - **Indexed total** with a space-by-category bar (video, photos, audio, documents) and a legend.
  - **Drive cards**: free space of the whole drive, with a bar showing how much of the drive is
    used and how much of it this app has catalogued. A drive whose size can't be read says so
    rather than showing a wrong number.
  - **Indexed folders**: each with its file count, size and when it was last scanned, plus Remove.
    Removing is disabled while a scan runs.
  - **Add folder**, **Scan now** and **Stop scan**, with live progress while scanning.
  - **Search** by name, and **Largest** and **Recently changed** lists, which are hidden while
    search results are showing.
  - **Filters and sorting** *(Lucas, 2026-09-16)*: category chips, a drive picker and a minimum
    size, which work without typing, so "videos over 1 GB on F:" is two clicks. Sort by date
    changed, size or name, with the direction named in words ("Largest first", "A to Z").
  - **Show more** on search results, Largest, Recently changed, biggest folders and duplicates,
    with "Showing 25 of 1,284" where the store knows the total. Pages come from the store with an
    offset, so a big library is never loaded into the window at once.
  - Behind it is one query, `IndexDb.queryFiles`: every filter is bound as a parameter, and the
    sort comes from a fixed table rather than from text the window sends, so a query can't carry
    SQL of its own. The IPC check drops unknown fields and rejects anything off its lists or out
    of range.
  - **Open** and **Show** on every file row *(Lucas asked for this, 2026-09-16)*: open in the
    system's default application, or show the file in the file manager. The renderer sends only a
    name, and the main process opens it **only if that exact path is in the index**, so a bug or
    injected script can't make the app launch something arbitrary (§5). Opening goes through the
    OS, never a shell command. A path that has moved since the last scan says so.
  - **Cleanup** *(Lucas picked this first, 2026-09-16)*, loaded only when asked because it costs
    extra queries: the folders holding the most, files that share a name and size, and big files
    nothing has changed in six months. Nothing is deleted from here.
    - Lookalikes are **not** claimed to be copies. Each group has a **Check** that reads the files
      and fingerprints them (`src/main/files/fileDigest.ts`: size plus 64 KiB from each end), then
      says either "identical at the start and end, so these look like real copies" or "not copies:
      N different versions". A full byte-for-byte hash of a film library would take minutes, and
      the wording never pretends otherwise.
    - Files that can't be read come back with no fingerprint and are counted separately, rather
      than quietly failing the group.
- **Hook** (`hooks/useLibrary.ts`): the view plus the lists, which come from separate queries.
  Lists refresh when the indexed file count changes rather than on every view, and typing is
  debounced so each keystroke isn't a query.
- Both hooks stay subscribed while the app is open, so a shuffle keeps running while the dashboard
  is on screen.
- **Not yet:** "Shuffle this" from a folder, a settings screen, thumbnails, and the integrated
  player (its placement still follows the embedding prototype, §4).

### Stats (Phase 5)

The sidebar has a Stats tab *(Lucas chose a tab over another dashboard section, 2026-09-16)*.

- **Play history:** the coordinator tells a `PlayHistory` when mpv *confirms* a file opened, and
  when a file plays to its end. A load that never opened isn't a play, and pressing Next isn't a
  finish. Late events from a replaced load are ignored, as everywhere in the coordinator, and a
  history that fails can never interrupt playback.
  - `ShufflerService` turns file names into full paths. Plays go into the index's SQLite database
    (`plays` table) in the app's data folder, so "never played" is simply indexed videos with no
    play on record.
  - A finish marks only a file's **latest** play, so replaying something and skipping it can't turn
    an earlier skip into a finish.
- **Stats tab** (`StatsScreen.tsx`, `useStats.ts`, `StatsService`, `statsIpc.ts`): plays, finished
  and skipped, how many different files, and since when; then favorites, most played, recently
  played, and indexed videos that have never played. Every row has a star, Open and Show.
- **Favorites** *(Lucas, 2026-09-16)*: a starred list with **no effect on the shuffle**, which stays
  purely random. Only a file the app already knows — indexed, or in play history — can be starred,
  so the renderer can't plant arbitrary paths in the database.
- Open and Show now accept a file known only from play history too, because a shuffle folder isn't
  necessarily indexed. It is still a path the app itself recorded.
- Display formatting (sizes, counts, relative times, short paths) moved to `src/renderer/src/format.ts`
  so every tab says them the same way.
- **Never played** can be sorted (newest, largest, A to Z) and extended with Show more. Once
  re-sorted, the list refreshes itself after each play so it stays accurate.

### Settings

The sidebar's Settings tab is live *(Lucas picked its three sections, 2026-09-16)*.

- **Indexed folders** moved here from the dashboard, which now links to them with "Manage
  folders": add, remove, rescan one folder, or scan them all.
- **Excluded folders** *(Lucas, 2026-09-16)*: folders scans skip, with everything inside them, for
  what name rules can't recognise, like a game library.
  - **Exclude folder** opens the system's folder picker, so the page never names the folder.
    Entries already indexed inside it leave the index at once, and each indexed folder's totals are
    recounted, in one transaction. Only index rows go; files are never touched (§2).
  - **Include again** only removes the entry from the list; the next scan brings the files back.
  - Refused, with the reason shown: excluding an indexed folder or a folder holding one (every scan
    would report it as skipped; removing the indexed folder says that clearly), indexing a folder
    inside an excluded one, and changing exclusions during a scan (the running scan would put the
    files straight back).
  - Stored in the index database (`excluded_folders`) beside the indexed folders, and passed to the
    scanner as part of its skip rules. Matching ignores case on Windows and macOS, as the other skip
    rules do, and `D:\Games2` is never mistaken for part of `D:\Games`.
- **Player:** shows the mpv a shuffle will start and where it came from. `locateMpv` prefers the
  `FILESHUFFLER_MPV` environment variable (for development), then a choice made here, then a
  bundled copy, a standard install location, and finally the PATH.
  - **Choose mpv…** opens the system's file picker and runs `mpv --version` (`probeMpv`) *before*
    saving anything. A program that isn't a working mpv is refused with the reason, so a wrong
    pick fails here rather than as a shuffle that won't start.
  - The check starts the program without a shell, with arguments as a list, and stops it after
    5 seconds. It only ever runs a program chosen through the system dialog in main; the page can
    never name a program for the app to run.
  - The player launch reads the choice every time, so it applies to the next shuffle without a
    restart. The "mpv wasn't found" message now points to Settings.
- **Privacy:** clear play history, favorites, saved shuffle progress, or the index, each behind a
  confirm step. Each clears only its own data and never touches the user's files. Clearing the
  index keeps the folder list, so a scan rebuilds it, and it is refused while a scan is writing.
- Settings live in their own `settings.json` (`SettingsStore`), apart from the index and shuffle
  progress, so clearing data can never clear settings. Both JSON files now share one crash-safe
  write (`atomicJson.ts`).
- **Not yet:** shuffle options (undo length, reopening the last folder), which Lucas left out for
  now.
- **Not yet:** starring from the dashboard's lists, total watch time (mpv would need to report each
  video's duration), and a way to clear play history.

## 7. Roadmap

**Working order** *(Lucas, 2026-09-15)*: features first, while the shape of the app is still
moving. Then optimization, then refactoring, then making the stack and the backend properly solid.
The front end comes last, as the least complex part. Two things that order depends on:
- **Optimization needs a baseline first** (§5). Measure the packaged Windows build, agree budgets,
  then optimize against numbers rather than guesses.
- **"Front end last" applies to polish, not correctness.** A feature still ships with whatever UI
  it needs, and the security baseline (§5) never waits.

**Where that leaves things** *(agreed 2026-09-16)*: features are frozen for v1. Next, in order:
1. **Packaging spike** — installer, mpv, licensing, data folder, clean-machine test (§7 Phase 6).
2. **Measure and harden** — a full-drive scan, a packaged-build performance baseline, deletes on a
   USB stick or network share, and error paths on a machine that isn't Lucas's. *Scan and index
   measured and improved, and the packaged-app baseline recorded (§5 Measurements). A damaged index
   and a second launch no longer break startup (§10, 2026-09-16). The USB and network delete tests
   and the clean machine remain, both for Lucas.*
3. **A small refactor** where the code actually strains (`src/main/index.ts`, the dashboard screen,
   duplicated IPC test fakes). Not a rewrite. *Done 2026-09-17, plus moving the database to a
   worker thread (§5 Measurements, §10).*
4. **Front end** — structure first (Cleanup as its own tab, starring from the dashboard, a
   first-run guide), then visual polish. The custom-player question (§4) feeds into this.

### Phase 0 — Setup

- [x] Lucas picks the stack (§5): TypeScript + Electron
- [x] Review the old Python code (§3 Why the old one felt bad)
- [x] Scaffold project (electron-vite react-ts), `.gitignore` with personal-data guards, vitest,
      fill in `CLAUDE.md` commands
- [x] Local git repo + first commit
- [x] Upgrade Node on the Mac to ≥ 22.12 (now 26.8.2). Use ≥ 22.12 on the Windows desktop too.
- [x] Approve npm 11 install scripts (`allowScripts` in package.json)
- [x] Upgrade Electron 39 → 44.3.0 (Electron 39 can't install on Node 26)
- [x] Create **public** GitHub repo and push, after the shuffler basics worked:
      https://github.com/Lw0ng01/FileShuffler

### Phase 1 — Shuffler MVP ⭐

- [x] Harden the starter template: sandbox on, preload exposes no raw IPC, navigation and new
      windows blocked (§5)
- [x] Pick folder (top-level files only): native folder picker plus `listVideoFiles`
- [x] Scan for video files (allowlisted extensions): `src/main/files/videoFolder.ts`
- [x] Shuffle engine (bag + playlist/cursor, endless cycles, seam rule) **with unit tests** (§3)
- [x] mpv integration behind the playback adapter (§4): launch, load file, detect end of video →
      autoplay next, key bindings inside mpv. Not yet connected to the app window (App shell item).
      Verified against mpv 0.41.0 on macOS.
- [x] Next / Back / Delete-to-trash (unload first, undo window), in the coordinator (§2 How
      delete is implemented). Buttons come with the app shell.
- [x] App shell with sidebar + shuffler screen (§6), player-local shortcuts (§6 Implementation)
- [x] Show current filename + successful-open coverage and failures
- [ ] Verify rapid navigation, EOF races, load failure, player exit, undo, failed trash, and empty folders.
      Unit tests cover these with a fake player and fake files. A click-through of the built app with
      real mpv on macOS passed (§6 Implementation). Still to do on Windows.
- [ ] Package on Windows now: bundle mpv and verify control/file release/trash on the target machine.
      mpv control, file release and trash are verified on the Windows desktop without packaging,
      including a delete from the running app.
- [ ] Record initial performance baseline (§5); agree budgets before optimization claims

### Phase 1B — Embedded player feasibility

- [ ] Prototype embedded native playback using the criteria in §4, with a packaged Windows build
- [ ] Compare against external mpv and assess macOS feasibility
- [ ] Document the decision: continue Electron embedding or compare a narrowly scoped alternative

### Phase 2 — Shuffler polish

- [ ] **VLC as a second player option** (user-installed VLC, local control interface) through the
      same playback adapter. Verify end-of-file/error detection and file release before trashing.
- [x] Remember last folder and shuffle progress between launches, with a Restart cycle button
      (§3 Implementation, §6 Implementation)
- [ ] "Show in Explorer/Finder" button
- [ ] Configurable shortcuts and clear error/recovery feedback
- [ ] Repeat the baseline after material playback/performance changes

### Phase 3 — Indexer (feeds the dashboard)

- [x] Safe scanner (rules in §2) → SQLite
- [x] Incremental rescans: files are keyed by path, so a rescan updates rather than duplicates, and
      a mark-and-sweep drops what the scan no longer found
- [x] Roots chosen through `IndexerService` and the library IPC; a first run offers the user's
      Videos, Pictures, Music, Documents and Downloads
- [ ] Settings screen to pick them, and the dashboard itself (front end comes later, see the
      working order above)
- [ ] Decide when scans run on their own: at startup, on a schedule, or only on request

**Implementation (Phase 3)**

- `src/main/files/scanRules.ts`: extends the shuffler's video allowlist into video, photo, audio
  and document categories, and holds the skip rules from §2.5. The shuffler and the indexer share
  one video list, so they can't drift apart.
- `src/main/files/scanner.ts`: reads chosen folders and everything inside them. Read-only, never
  follows symlinks or junctions, skips system and dot folders (roots included), walks level by
  level with bounded concurrency and a depth cap, hands files over in fixed-size batches, reports
  progress, stops promptly when cancelled, and records a folder it couldn't read instead of
  abandoning the whole drive.
- `src/main/library/indexDb.ts`: roots and files in SQLite (§5), with totals by category and by
  drive, largest, recently changed, and a name search that treats `%` and `_` as plain text. Scan
  ids always increase past the highest stored, because two scans inside one millisecond would
  otherwise share an id and the sweep would silently delete nothing.
- `src/main/app/indexerService.ts`: one scan at a time, cancellable, throttled progress. **A
  cancelled pass deliberately skips the sweep**: it only saw part of the folder, so treating
  "not seen yet" as "deleted" would empty the index.
- `src/main/libraryIpc.ts`: the same rules as the shuffler's IPC — the app's own window only, with
  paths, limits and search terms checked at runtime and limits capped.

### Phase 4 — Dashboard

- [x] Drives: capacity / used / free (`driveSpace.ts`, drive cards in §6 Dashboard)
- [x] Breakdown by category
- [x] Largest files, recently changed, search
- [x] Open a file, or show it in the file manager, from any dashboard list (indexed paths only)
- [x] Settings screen: indexed folders, choosing and testing mpv, and clearing data (§6 Settings)
- [x] Paging for long lists (Show more), search filters and sorting (§6 Dashboard)
- [ ] Thumbnails, and virtualized lists if a library outgrows Show more
- [ ] "Shuffle this" from a folder in the dashboard
- [ ] Implement the validated embedded player with custom controls, subtitles/audio tracks,
      history/resume, and the same authoritative shuffle session
- [ ] Verify dashboard indexing/browsing remains responsive during playback

### Phase 5 — Cleanup tools and stats ⭐ *(picked by Lucas, 2026-09-15)*

Lucas chose these as the directions that make this more than a video shuffler, alongside the
dashboard in Phases 3–4. Shuffling photos and music was offered and left out for now.

- [x] **Cleanup tools**, view-only (§6 Dashboard): biggest folders, possible duplicates with a
      fingerprint check, and files not touched in six months
- [ ] Narrow the stale list to Downloads specifically, and let the user choose the age
- [ ] Decide whether the dashboard ever deletes. It doesn't today: Open and Show only. Doing it
      properly means the shuffler's undo window and identity recheck (§2.3), not a quick delete
- [x] **Stats**: most played, recently played, never played, finished versus skipped (§6 Stats).
      Total hours are still to do: they need each video's duration from mpv
- [x] **Favorites** as a starred list. Lucas chose no shuffle weighting (2026-09-16)
- [x] Clearing play history (and favorites, progress or the index) from Settings
- [ ] Starring from the dashboard
- [ ] Thumbnail gallery for photos/videos
- [ ] Other external players (IINA, generic) only if needed

### Phase 6 — Release polish and public download

The app is meant to be downloadable by other people (§1), so this phase is about strangers'
machines, not Lucas's.

- [x] Build the Windows installer (spike findings below)

**Spike findings (2026-09-16)**
- `npm run build:win` worked unchanged: about 45 s, a one-click per-user NSIS installer
  (`FileShuffler-Setup-<version>.exe`, about 112 MB; 368 MB installed, mostly Electron). No admin
  rights needed.
- The packaged app starts and stays up, and leaves no stray mpv behind.
- **One unexplained early exit.** In one launch the packaged app had exited within 8 seconds, with
  no crash output captured. Five later launches did not repeat it, including three from a fresh
  first run with no data folder and two with Electron's logging on. Not reproduced, so not fixed:
  watch for it during the clean-machine test.
- Neither the installer nor the app is signed, so SmartScreen will warn on download.
- **mpv is not bundled** *(Lucas, 2026-09-16)*. People install it themselves and point Settings at
  it, which "Choose mpv" already supports. That avoids GPL distribution duties, keeps the
  installer smaller, and keeps the no-network rule (§2.7). A first-run screen that says so belongs
  to the front-end pass.
- Lucas finds mpv's own window unattractive and would consider a **custom built-in player**
  instead. That is the Phase 1B embedded-player milestone (§4), with a real trade-off: Chromium's
  own `<video>` looks fully custom and carries no GPL duty but plays far fewer formats (MKV, AVI,
  WMV are unreliable or unsupported), while embedding libmpv keeps mpv's formats and brings the GPL
  question back. To be decided with a prototype, not assumed.
- **Clean-machine test still to do.** Windows 11 Home has no Windows Sandbox, so it needs another PC,
  a virtual machine, or at least a fresh Windows user account (no mpv on its PATH, empty app data).
- Found by the spike: without a pinned folder, the packaged app used the same `file-shuffler` data
  folder as development, contrary to an earlier note. Now pinned (§3 Implementation).
- [ ] macOS build and platform-specific validation
- [ ] Document supported media combinations, resource measurements, and known limitations
- [x] **mpv's terms:** settled by not bundling it (below). mpv is GPLv2+ by default and LGPLv2.1+
      only when built with `-Dgpl=false` (its `Copyright` file); the Windows build in use states
      neither and ships no license files. Bundling would mean shipping license texts and publishing
      matching source for mpv and every library in that build, with every release.
- [ ] **A LICENSE for FileShuffler itself:** deferred by Lucas (2026-09-16). Settle it before the
      first public release: a public repository with no license means nobody may legally reuse it.
- [ ] **Unsigned installer:** Windows SmartScreen warns on a download from an unknown publisher,
      and the user has to click through "More info → Run anyway". Either say so plainly in the
      README or buy a code-signing certificate. Never coach people to disable protections.
- [ ] **A README for users**, not developers: what it does, install steps, the SmartScreen note,
      where saved progress lives, and how to remove it
- [x] **Decide the app-data folder name:** `FileShuffler` installed, `FileShuffler Dev` in
      development, kept separate on purpose (§3 Implementation)
- [ ] **First run on a clean machine:** no mpv, no PATH entry, no development tools. The app must
      explain what's missing rather than fail silently. Choosing mpv in Settings now covers the
      no-PATH case; a guided first run that points there is still to do.
- [ ] GitHub Releases: attach the installer, decide how versions are numbered, and keep notes on
      what changed

## 8. Concerns / risks

- **Embedded rendering is unproven.** The early prototype controls this risk; changing the
  application shell is a possible outcome, not a foregone conclusion.
- **Electron has baseline overhead.** Measure the complete app plus player; do not promise
  native-toolkit memory usage or assume the project cannot leak resources.
- **Scope growth:** shuffler first; dashboard and embedded player remain planned. Players beyond
  mpv and VLC, and bonus tools, must not crowd out the core flow.
- **Controlling an external player** is the trickiest part of the MVP (focus, file locks,
  per-player differences). mpv first keeps it manageable.
- **Scanning every drive is slow.** Scan in the background, cache results, let the user pick roots.
- **Drives without a Recycle Bin** (USB/network): see §2.2.
- **Cross-machine paths:** settings and shuffle history are per machine, never committed.
- **Thumbnail cache privacy:** needs a "clear cache" button.
- **Publishing to strangers** (§1): an unsigned installer looks untrustworthy to Windows, bundling
  mpv carries its licensing terms, and a delete bug on someone else's files is far worse than on
  ours. Treat the safety rules in §2 as release blockers, not preferences.
- **Assumptions that only hold here:** a fast machine, an external drive that recycles, mpv already
  installed, and an English Windows. None of these are guaranteed on someone else's PC.

## 9. Open questions

1. ~~Old Python code~~: reviewed 2026-09-15 (§3 Why the old one felt bad).
2. Set performance budgets after measuring the first Windows release build.
3. Embedded playback approach, macOS limitations, and initial compatibility matrix: resolve
   through Phase 1B, rather than assuming integration is solved.
4. Distribution: which licence this project carries (deferred), and whether the unsigned
   SmartScreen warning is acceptable or worth paying to avoid (§7 Phase 6). ~~Whether the installer
   bundles mpv~~: no, decided 2026-09-16.
5. A custom built-in player instead of mpv's window: Chromium video (custom look, fewer formats, no
   GPL duty) versus embedded libmpv (mpv's formats, GPL question returns). Decide with a prototype.
6. ~~A "folders to exclude" setting~~: added 2026-09-16, Lucas's call despite the feature freeze
   (§6 Settings).

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
- **2026-09-15:** Architecture and scope review (Lucas, with a Codex review).
  - Lucas confirmed the shuffler comes first. The dashboard, a custom built-in native player,
    efficiency and demonstrable architecture all remain important.
  - Kept Electron/React/TypeScript for the initial delivery, without claiming guaranteed
    efficiency. Any stack change will rest on an early embedded-player prototype and measurements.
  - Defined application/domain/adapter boundaries and runtime IPC validation.
  - Moved Windows packaging into Phase 1.
  - Clarified shuffle progress/history and fail-closed trash/undo behavior.
  - Removed unsupported framework ease/size comparisons.
- **2026-09-15:** Follow-ups to the review, approved by Lucas.
  - **VLC restored as a planned option** (Phase 2). Phase 1 still ships only mpv, but behind a
    playback adapter shaped to fit VLC (§4). IINA and generic players stay deferred.
  - Setup notes marked verified: they were re-checked on `main` after the Electron 44 merge.
  - Security baseline applied to the starter code: sandbox and context isolation on, Node
    integration off, navigation and new windows blocked. The preload now exposes only a read-only
    `api.versions` instead of Electron's full IPC bridge (`@electron-toolkit/preload` removed).
  - `CLAUDE.md` trimmed to how-to-work guidance that links to this doc instead of repeating it.
  - Change log entries now use one format.
- **2026-09-15:** Shuffle engine implemented (Phase 1).
  - Pure `ShuffleSession` in `src/main/domain/shuffle.ts` with 26 deterministic tests.
  - Resolved open details of §3: coverage counts only this cycle's draws, failed items are retried
    next cycle but never loop, pending deletes are skipped rather than removed (see
    §3 Implementation).
  - Tests were checked against deliberately broken versions to confirm they catch real bugs.
- **2026-09-15:** mpv playback implemented (Phase 1).
  - Player interface, coordinator and mpv adapter, with 27 unit tests using a fake player and a
    fake mpv.
  - 6 integration tests pass against a real mpv 0.41.0 (official macOS build, checksum verified).
  - mpv's IPC behavior was checked against its docs and a recorded probe before writing the
    adapter.
  - Choices: `>`/`<` for Next/Back inside mpv, `--no-config` for predictable playback, and a file
    counts as released only once mpv reports `idle-active`. See §4 Implementation.
- **2026-09-15:** Folder reading and delete-to-trash implemented (Phase 1).
  - Lucas left the in-player keys to Claude: `>`/`<` for Next/Back, so the arrow keys keep seeking,
    and `DEL` to delete.
  - `listVideoFiles` reads a folder's top level through an allowlist, excluding `.ts`/`.mts`.
  - Delete has a 5-second undo, an identity recheck, a wait for the player to release the file,
    and fail-closed trashing (§2 How delete is implemented).
  - Checked Electron's Windows `trashItem` source: it aborts rather than permanently deleting items
    that can't be recycled. Still to confirm on a real Windows drive.
  - 31 tests for folder reading, file identity and the coordinator, including 11 delete cases. No
    dependency changes, so no `npm install` was needed.
  - Mutation check: breaking the identity recheck, the wait for the player to release the file,
    cancel-on-close, or keeping the file when trashing fails each made a delete test fail.
- **2026-09-15:** App screen implemented (Phase 1).
  - `ShufflerService`, the IPC bridge with sender and argument checks, `findMpv`, and the React
    shuffler screen (§6 Implementation).
  - Coordinator gained `replacePlayer()` and `resume()`, so closing the mpv window keeps the session
    and any pending deletes.
  - The Back/Next/Delete row is hidden until something plays, because two competing main buttons
    on the ready screen looked cluttered in the first screenshot.
  - 100 unit tests pass (106 including the 6 real-mpv tests). A click-through of the built app with
    real mpv passed 21 of 21 checks.
- **2026-09-15:** Published to GitHub and added a handoff section.
  - Before publishing, every commit was rewritten to use GitHub's private email instead of Lucas's
    personal address. Every commit and every file version was then checked for emails, home folder
    paths, tokens and keys.
  - The public repo is https://github.com/Lw0ng01/FileShuffler.
  - Added "Resume here" at the top of this doc, because a new session (for example on the Windows
    desktop) starts without this session's chat or local memory.
- **2026-09-15:** Windows desktop set up, first Windows checks, and the old shuffler reviewed.
  - Installed and checked: Node 24.21.0, npm 11.19.0, Git 2.55.0, and mpv v0.41.0-244 from winget
    (`shinchiro.mpv`), which isn't added to the PATH on its own (§5 Existing setup notes).
  - All 6 real-mpv integration tests pass over the Windows named pipe.
  - One unit test failed on Windows: `lstat` reports `ENOENT`, not `ENOTDIR`, for a path through a
    file, and also for a missing folder or drive. An unplugged drive would have looked like a
    deleted file and been dropped from the session; nothing would have been trashed.
    `readFileIdentity` now calls a file gone only when its folder still exists, with a new test.
  - Probe with disposable clips: mpv doesn't lock a file it is playing, and `trashItem` sent clips
    on the internal NTFS drive and an external exFAT drive to the Recycle Bin (confirmed there).
    The exFAT drive reported stable file IDs.
  - Reviewed the old Python shuffler: every Next used `random.choice`, confirming the repeat
    problem in §3. It also deleted permanently with `os.remove`.
  - Added `.gitattributes` (LF everywhere), because Git for Windows' `core.autocrlf=true` checked
    files out with CRLF and Prettier flagged about 4,000 lines.
  - Not yet: the app screen on Windows, and drives that can't recycle (Resume here).
- **2026-09-15:** First run of the app on Windows.
  - Lucas ran `npm run dev` from Command Prompt. Shuffling a small folder worked, and a delete from
    the app went to the Recycle Bin on the external exFAT drive (confirmed in the Recycle Bin).
  - `npm run dev` had failed in PowerShell: the window predated the Node install, and Windows'
    default execution policy blocks `npm.ps1`. Noted in §5 and `CLAUDE.md`.
  - Not yet: Undo, keys inside the mpv window, a larger folder, and drives that can't recycle.
- **2026-09-15:** Shuffle checked at 1400 videos, and Undo now says what it did.
  - Lucas tested further on Windows: Undo, the keys inside the mpv window, and a folder of about
    1400 videos on the external drive all worked. Only drives that can't recycle remain untested.
  - A throwaway simulation drove the real engine with 1400 items and `Math.random`; 18 of 18 checks
    passed (§3 Implementation). Lucas reviewed how soon a video can return at a cycle change and
    kept the seam rule as it is.
  - Lucas asked for a visible confirmation of Undo, because the toast simply disappeared.
    `undoDelete` now returns `restored`, `trashing` or `unknown` through the coordinator, service,
    IPC and preload, and the screen shows a short note that clears itself.
  - An undo really can be too late: once the trash step starts it cannot be cancelled, so that case
    says so rather than implying the file came back.
- **2026-09-15:** Cycle memory and a Restart cycle button (Phase 2).
  - The app now reopens last time's folder and carries on through the same cycle instead of
    starting over, which matters most at 1400 videos where a cycle takes a long time.
  - `ShuffleSession` gained `snapshot()`, a `restore` option and `restartCycle()`. `ProgressStore`
    keeps one JSON file in the app's data folder: temporary file then rename, a corrupt file reads
    as no progress, and the 20 most recent folders are kept (§3 Implementation).
  - A restored cycle is reconciled with the folder as it is now, so videos deleted elsewhere drop
    out and new ones join the unplayed part at random.
  - Lucas asked for the Restart cycle button alongside the memory, so a remembered cycle can always
    be abandoned. It confirms first, because restarting discards coverage.
  - Direction after the shuffler, chosen by Lucas: the dashboard, cleanup tools, and stats with
    favorites. Shuffling photos and music was considered and left out for now.
- **2026-09-15:** Aimed at a public download, and set the working order.
  - Lucas wants the app downloadable from GitHub for other people to use, so §1 now states that and
    Phase 6 covers what strangers' machines need: a licence, mpv's bundling terms, the SmartScreen
    warning on an unsigned installer, a user-facing README, and a clean-machine first run.
  - Recorded the working order Lucas set: features, then optimization, then refactoring, then a
    properly solid stack and backend, with the front end last. Noted that optimization still waits
    on a measured baseline (§5), and that "front end last" means polish, not correctness.
  - Noted a quirk worth settling before release: a development run and an installed build use
    different app-data folders, so saved cycles don't carry across (§3 Implementation).
  - Phase 5 is now cleanup tools and stats rather than loose bonus ideas, and Phase 0's public-repo
    item is ticked.
- **2026-09-16:** Indexer backend, the first piece of the dashboard (Phase 3).
  - Scan rules, a safe scanner, a SQLite store, the indexer service and the library IPC, with tests
    for each. No UI yet: the dashboard screen is next, in line with the working order (§7).
  - **Index store decided:** Node's built-in `node:sqlite`, after checking it really works inside
    Electron 44 (§5). No native dependency to rebuild, nothing new in `allowScripts`.
  - Rescans update by path and sweep away files that are gone, so the index follows the disk
    without duplicating rows.
  - Found by testing: scan ids taken from `Date.now()` collided within a millisecond, which
    silently disabled the sweep. Ids now always increase past the highest one stored.
  - Found by testing: a folder holding more files than one batch was handed over as a single huge
    write; batches are now flushed at their exact size.
  - A cancelled scan keeps what it found but skips the sweep, so cancelling can never empty the
    index.
- **2026-09-16:** The dashboard screen (Phase 4, first pass).
  - The sidebar switches between Shuffle and Dashboard. The new screen shows indexed totals with a
    category bar, drive cards, the indexed folders with add, remove and scan, live scan progress,
    search, and the largest and most recently changed files (§6 Dashboard).
  - Drive cards needed something the index can't know: `driveSpace.ts` reads real capacity and free
    space from the filesystem, returns null rather than throwing when a drive can't be read, and is
    refreshed after a scan and whenever the window asks for a view.
  - Adding a folder to index goes through the main process's folder picker, like the shuffler's.
  - Found by testing: making `getView` refresh capacity turned its IPC handler async, so a test
    that invoked it without awaiting saw the call arrive too late.
  - Still to do here: "Shuffle this" from a dashboard folder, a settings screen, thumbnails, and
    paging for very large libraries.
- **2026-09-16:** Open and Show on dashboard file rows, after Lucas tried the dashboard.
  - Lucas asked to be able to act on what search finds. Every file row now has Open (the system's
    default application) and Show (the file manager).
  - The renderer names a file; the main process opens it only if that exact path is in the index,
    so nothing arbitrary can be launched, and opening uses the OS rather than a shell command (§5).
  - Lucas also set the order for what follows: cleanup tools first (duplicate finder, old
    Downloads, biggest folders), then stats and favorites, then search and browsing polish.
    Automatic scanning was offered and left out for now, so scans stay deliberate.
- **2026-09-16:** Cleanup tools on the dashboard (Phase 5, the first of the three directions).
  - Three lists, loaded only when asked: biggest folders, possible duplicates, and files not
    touched in six months (§6 Dashboard). All view-only.
  - **Duplicates are a suggestion, not a claim.** The index can only see that files share a name
    and size, so each group has a Check that reads the files and fingerprints them
    (`fileDigest.ts`: size plus 64 KiB from each end). The verdict says what was actually
    compared, because a full hash of a video library would take minutes, and a wrong "these are
    copies" could cost someone their files.
  - New store queries: biggest folders, duplicate candidates ranked by wasted space, files
    unchanged since a date, and an exact name-and-size lookup.
  - Fingerprint reads are one file at a time, and an unreadable file reports no fingerprint rather
    than failing the group.
- **2026-09-16:** Play history, a Stats tab, and favorites (Phase 5, the second direction).
  - Lucas tried the cleanup tools: they work, but Cleanup should be its own tab, because it took
    scrolling to find. Noted for the front-end pass rather than done now (§7 working order).
  - Decided by Lucas: favorites are a starred list with no effect on the shuffle, and stats get
    their own tab instead of another dashboard section.
  - The shuffler now records plays. An open counts once mpv confirms it, a finish only when the
    file reaches its end, and a recording failure can't stop playback (§6 Stats).
  - Plays and favorites share the index's SQLite database, so stats can combine the two.
  - New `StatsService`, stats IPC with the usual sender and argument checks, and the Stats tab.
    Display formatting moved to a shared `format.ts`.
- **2026-09-16:** Browsing polish, part one: show more, search filters, and sorting.
  - Lucas asked whether Never played covers every drive: it does, but shows only 10 rows sorted by
    date, which can make it look like one folder. That prompted paging here.
  - Lucas picked all four polish items. Show more, filters and sorting share one new query, so
    they ship together; the settings screen is mostly front end and follows as its own branch.
  - `IndexDb.queryFiles` filters by name, category, drive and size, sorts by size, date or name in
    either direction, pages with an offset, and reports the total. The sort comes from a fixed
    table and every filter is a bound parameter, so nothing from the window reaches the SQL text.
  - The dashboard gained a filter bar and Show more on its lists. Never played on the Stats tab
    can be re-sorted and extended.
  - Found by testing: name order is case-insensitive, and a space sorts before a dot, so
    "Beach photo.jpg" comes before "beach.mp4". The code was right and the test's expectation was
    not.
- **2026-09-16:** Browsing polish, part two: the Settings tab.
  - Lucas chose three sections: indexed folders, choosing mpv, and clearing data. Shuffle options
    (undo length, reopening the last folder) were offered and left out.
  - Indexed folders moved from the dashboard to Settings, with a rescan for a single folder. The
    dashboard keeps Scan now and gains a "Manage folders" link.
  - **Choosing mpv** is aimed at people downloading the app, who can't be expected to edit a PATH:
    pick the program, and it is tested with `mpv --version` before being saved, so a wrong choice
    is caught with a reason. It runs without a shell, times out, and only ever runs a program
    chosen through the system dialog. The Settings page shows where the mpv in use came from.
  - **Clearing data** covers play history, favorites, shuffle progress and the index, each
    separately and each behind a confirm. This settles the privacy gap flagged when play history
    arrived: viewing history is personal and can now be erased.
  - Settings get their own file, so clearing data can't clear them, and the two JSON stores share
    one crash-safe write helper.
- **2026-09-16:** Features frozen for v1; packaging spike.
  - Lucas asked whether the app had enough features before moving to the front end. Agreed: yes for
    v1, and the next steps follow his own working order, with packaging first because it is the
    riskiest unknown (§7 working order).
  - The installer builds unchanged and the packaged app runs. It is unsigned (§7 Phase 6).
  - **mpv is not bundled** *(Lucas)*: mpv is GPLv2+, and shipping it would mean publishing matching
    source for mpv and its libraries with every release. People install it and choose it in
    Settings. Lucas also raised a custom built-in player, because mpv's window looks ugly to him;
    recorded against the embedded-player milestone (§4, §9).
  - FileShuffler's own license: deferred by Lucas, to settle before a public release.
  - **Correction:** an earlier note said development and the installed app used different data
    folders. The spike showed both used `file-shuffler`. Lucas chose to keep them apart, so they are
    now pinned to `FileShuffler` and `FileShuffler Dev`, and the first development run copies the
    old folder's data across once, leaving the original as a backup.
- **2026-09-16:** Measure and harden, part one: scanning and the index.
  - **Real drives:** scanning is fast (about 4,400 folders a second), but on Lucas's D: 99% of the
    folders walked were program and game installs, and 82% of his profile's were Python libraries
    in 24 virtual environments. Program installs are now skipped on any drive, and so are
    `site-packages`, `__pycache__` and folders holding `pyvenv.cfg` (§2.5).
  - **Synthetic libraries at 250,000 and 1,000,000 files** exposed the real bottleneck: database
    writes and queries on the main process. Changes were chosen by comparing variants on the same
    data, not guessed: a larger SQLite cache and scanner batches, a `(name, size)` index, an upsert
    that leaves unchanged files alone, and totals cached until the index changes. At 250,000 files a
    rescan went from 28 s to 1.9 s and the duplicate check from 1.4 s to 36 ms (§5 Measurements).
  - A tempting option was rejected by measurement: four indexes made queries fast but a rescan 33 s,
    slower than before. So was a `folder` index, which didn't speed up biggest folders.
  - Still open: database work on the main process (about 1 s freezes at a million files, for the
    refactor step), a packaged-app memory and startup baseline, USB and network delete tests, the
    clean machine, and whether to add a folder-exclusion setting for games (§9).
- **2026-09-16:** Measure and harden, part two: the packaged app and startup failures.
  - **Baseline:** the packaged app shows its window about 0.3 s after launch (0.8 s on a first
    run) and idles at about 190 MB private memory across its four processes; Lucas's real index
    made no difference (§5 Measurements). Proposed budgets: under 1 s and under 250 MB.
  - **A damaged index no longer stops the app from starting.** The index opened before any window
    existed, so an unreadable `index.db` crashed startup, taking the shuffler with it. Now a file
    SQLite reports as damaged or not a database is renamed to `index.db.unreadable-<time>` beside a
    fresh index, and a warning explains that Scan now rebuilds the file list and that play history
    and favorites were in the old file. Any other failure, such as a locked file, still stops
    startup, since moving a healthy index aside would lose history for nothing
    (`src/main/library/openIndex.ts`). Checked in the packaged build with a garbage index.
  - Found while testing: a damaged file opens without error and fails on the first statement, and
    SQLite discards its journal files itself when that connection closes. `IndexDb` now closes the
    connection when setup fails; otherwise Windows couldn't rename the file.
  - **Only one copy runs per data folder.** Two copies would write the same index and progress files
    and could each start mpv. A second launch now brings the open window forward and exits before
    opening anything. Development and the installed app use different data folders, so they can
    still run side by side. Checked in the packaged build.
  - Still open: the USB and network delete tests and the clean machine (Lucas), and the
    folder-exclusion question (§9).
- **2026-09-16:** Excluded folders in Settings *(Lucas asked for it, lifting the feature freeze for
  this one setting)*.
  - For folders name rules can't recognise, such as game libraries. Excluding one removes its index
    entries at once and scans skip it from then on; files are never touched (§6 Settings).
  - Refuses combinations that would only confuse: excluding an indexed folder or one holding it,
    indexing inside an excluded folder, and changing exclusions mid-scan.
  - Checked on a copy of Lucas's real index in the packaged build: the new table was added on
    startup with all 6 folders and 21,976 files intact. Not exercised by hand: the picker itself.
- **2026-09-17:** The small refactor (§7 working order). No features change.
  - **The index moved to a worker thread.** At a million files the dashboard's heavy reads froze
    the window for about 3 seconds; through the worker the longest stall was about 20 ms (§5
    Measurements).
    - How it works: `indexWorker.ts` owns the database and answers one request at a time, in the
      order sent, so a scan's writes always land before its sweep. Services use an `IndexStore`,
      where every index operation returns a promise, so `IndexerService` and `StatsService` became
      async.
    - The worker answers only a fixed list of operations (`INDEX_METHODS`).
    - If the worker fails or stops, every waiting request is rejected rather than left hanging.
    - Opening, including setting a damaged index aside, now happens in the worker. An index that
      can't be opened for any other reason now shows an error and quits, instead of crashing.
    - Views built from answers that arrive out of order can't overwrite a newer view.
    - Cost: about 22 MB more idle memory.
  - **`src/main/index.ts` split** into startup and shutdown (`index.ts`), service wiring
    (`services.ts`), the window and its security settings (`mainWindow.ts`), and system dialogs
    (`dialogs.ts`).
  - **Dashboard screen split** from 551 lines into its sections under `components/dashboard/`,
    which also prepares Cleanup to become its own tab.
  - **One shared `FakeIpc`** (`src/main/testing/fakeIpc.ts`) replaces four copies in the IPC tests.
  - Checked in the packaged build with a copy of Lucas's real index: Dashboard, Settings and Stats
    load real data through the worker, a second launch still just focuses the window, and a normal
    close shuts the index cleanly in about 130 ms.
- **2026-09-17:** Handoff to the Mac laptop. "Resume here" now opens with a start-of-session
  checklist (pull, install, and a check on macOS of the worker thread and Excluded folders, which
  were only run on Windows). `CLAUDE.md` gained "Working with Lucas", recording how sessions have
  worked (a branch per step that Lucas merges, commit author, personal-data checks, no
  screenshots of his screen, the feature freeze), which until now lived only in chat history.
- **2026-09-17:** `driveOf` takes the platform explicitly, so the suite passes on macOS too.
  - Four tests that pass on Windows failed on the Mac laptop. `driveOf` parsed with `node:path`'s
    host flavour, so `D:\Videos` yielded an empty drive on macOS instead of `D:`, which also split
    one drive card into two. Separately the scanner rejected `C:\Windows` as "not an absolute path"
    before the system-location rule could classify it, because it isn't absolute under POSIX.
  - `driveOf(path, platform)` and a new `ScanOptions.platform` now take the flavour as an argument
    defaulting to `process.platform`, mirroring `systemSkipRules(platform)`. `IndexerService` takes
    the same option, uses it for drive letters and its default rules, and passes it to the scanner.
    Because the default is this machine's platform, a real scan behaves exactly as before on both
    systems: the fix is about what the tests can express, not about what the app does.
  - The two test files written around Windows paths now pin `platform: 'win32'`, and `driveOf`
    gained direct tests for both flavours. 289 unit tests pass on macOS, with lint and typecheck
    clean.
  - Found while checking, and left alone: the intermittent real-mpv load test (known quirks above).
    No file under `src/main/playback/` is touched by this branch.
- **2026-09-17:** Front-end foundations: a UI skill, and Cleanup as its own tab.
  - Lucas asked whether Claude skills would help here, since for this app his concern is a concise,
    fluid front end rather than frameworks. The agreed reasoning: a skill is not worth writing to
    *teach* design, which is general knowledge, but is worth writing against **drift**. Every
    session starts cold, now across two machines, so without written values each one picks slightly
    different durations and easings and the app stops feeling coherent. That is the same argument
    that justifies this document.
  - `.claude/skills/fileshuffler-ui/SKILL.md`, kept in the repo so it is versioned with the code and
    travels between the MacBook and the Windows desktop; a skill in `~/.claude` would not. Entries
    are labelled **Recorded** (already true in the code, or a hard constraint) or **Open** (Lucas
    decides). Written thin on purpose: it records the CSP and no-network limits, the existing
    tokens, the radii scale, the focus and icon conventions and how to add a screen, and leaves
    durations and easings Open rather than inventing his taste and following it back.
  - Found while writing it: there are only two transitions in 842 lines of CSS, and **no
    `prefers-reduced-motion` handling anywhere**. The skill requires one alongside the first real
    animation, rather than as a later pass.
  - **Cleanup is its own tab**, which Lucas asked for on 2026-09-16 because it sat at the bottom of
    the dashboard and took scrolling to find. `dashboard/CleanupSection.tsx` became
    `components/CleanupScreen.tsx` with a real screen header, Refresh moved up into it, and each of
    the three lists is now its own section. No query or behaviour changed, and the dashboard no
    longer takes a `cleanup` prop.
  - Rejected, with reasons: third-party skill packs (generic advice, not this project's taste),
    `theme-factory` (it themes artifacts, not an Electron renderer), and replacing the undo toast
    with Sonner (it gates the delete window, so it is safety-critical working code).
  - Deliberately left to its own branch: the embedded-player spike (§4, §9 item 5).
- **2026-09-17:** Cross-platform fixes, so the app is correct on macOS as well as Windows.
  - **Drive grouping was wrong on macOS.** `driveOf` returned the filesystem root, which is `/` for
    every path on a Mac. So every mounted volume collapsed into a single Dashboard card, the drive
    filter offered one useless `/` option, and `refreshDriveSpace` wrote one `/` entry per root,
    leaving the card showing whichever volume's free space happened to be read last. Windows was
    never affected, since `C:` and `D:` already separate.
  - Now `driveOf` returns the mount point: `/Volumes/<name>` for a mounted volume, `/` for the
    startup disk. `/System/Volumes/...` deliberately stays on `/`, because those are firmlinks to
    the startup disk rather than drives of their own. It stays pure string work, with no disk
    access, because it runs for every file in a scan.
  - Written as a failing test first: the new case failed with `expected '/' to be
    '/Volumes/Archive'` before the fix. The firmlink and Linux cases passed already and stay as
    regression guards. 292 unit tests now, up from 289.
  - **Existing Mac indexes need one rescan.** `drive` is written per file at scan time, so rows
    scanned before this still read `/` until Scan now rewrites them. Deliberately not migrated:
    each machine keeps its own index and the laptop's is new, so a migration would be cost for
    almost no one.
  - **The intermittent real-mpv test was a budget mismatch, not a dropped event.** The suite
    declares a 20 s timeout, but its `waitFor` helper gave up after 8 s, so in a full run - several
    real mpv processes alongside 27 other test files - a one-second clip could miss its own
    deadline. It passed 8/8 in isolation and failed only in full runs. `waitFor` now allows 15 s.
    Not proven beyond doubt: no failing run was captured with the raw mpv events logged. If it
    comes back, instrument the adapter rather than raising the number again.
  - Audited and deliberately left alone, because they are already right on both systems:
    `videoFolder.ts` (lowercases extensions, and `isFile()` skips links and junctions),
    `fileIdentity.ts` (unmounting a volume removes `/Volumes/<name>`, so the parent-folder check
    throws "can't tell" and a delete fails closed, exactly as on Windows), and `dialogs.ts`.
- **2026-09-17:** Motion on the Shuffle screen, and the first agreed design decisions.
  - Lucas set the direction: springs on the moments that carry meaning and nothing elsewhere, the
    Shuffle screen first, and the existing roomy layout kept and refined rather than replaced. Those
    entries moved from "Open" to "Recorded" in the `fileshuffler-ui` skill.
  - **Springs without a dependency.** The spring is a CSS `linear()` curve, which expresses the real
    overshoot instead of approximating it with a bezier, behind an `@supports` test with a
    `cubic-bezier` fallback. No animation library, so nothing joins the bundle and the CSP and
    no-network rules are untouched. It has to be `@supports` rather than two declarations, because a
    custom property is not validated until it is used: an unsupported `linear()` would have made
    every rule using it invalid rather than falling back.
  - **No new renderer state.** Every animation runs on mount, triggered by React mounting an element
    or by a changing `key`. Pressing Next twice quickly restarts the title animation instead of
    queueing one, and no timing logic enters the renderer, which has no test setup at all.
  - Moments that move: the now-playing filename, the controls and key hints arriving, banners, the
    undo toast, and button press feedback (60 ms down, spring back). Nothing loops or pulses.
  - **The app now honours `prefers-reduced-motion`**, which it ignored entirely before.
  - A typographic fix alongside: `.now-title` inherited the body's 1.45 line-height, loose at 26px
    and blurring the jump from eyebrow to title. Now 1.2.
  - Deliberately not done: exit animations. React unmounts immediately, so animating one out needs a
    presence hook, and that would put timing state in the undo path, which gates file deletion and
    has no tests. Worth it only if the entrances feel lopsided in use (skill, Motion "Open").
  - **Not yet seen running.** Springs are judged by feel, not by reading CSS: `npm run dev`, then
    Next, Back, and a delete with an undo.
- **2026-09-17:** Visual overhaul, towards Apple's design language.
  - Lucas's verdict on the motion pass was that it looked "pretty normal", and he opened the door to
    a complete overhaul: clean, concise, Apple-like. He then chose the full Mac window treatment,
    both palettes designed with equal care, and near-monochrome colour.
  - **Why it read as generic**, which is what the work fixes: every element was wrapped in a 1px
    border; labels were uppercase and letter-spaced, an enterprise-dashboard habit; the accent was
    spent on decoration; the type scale was compressed, so boxes did the work type should do; and
    the window was a default frame with a page inside it.
  - **Chrome.** macOS now hides the title bar so the sidebar runs to the top edge, with a vibrant
    sidebar behind it. That brings a drag region - the sidebar drags the window, so every control
    inside it opts out with `no-drag`, or it would look fine and ignore clicks - and `.is-mac`
    clearance for the traffic lights, set from the user agent since the renderer has no Node access.
  - **Windows deliberately keeps its normal frame**, taking only the Mica material. A hidden title
    bar there needs `titleBarOverlay` and reserved space for the window controls, none of which can
    be checked from a Mac; shipping an undraggable window would be worse than a plain one.
  - **A launch bug fixed on the way:** `backgroundColor` was hard-coded `#0e1014`, so a light-mode
    user saw a dark flash at every launch. It now follows `nativeTheme`, and keeps following it
    while running.
  - **Colour.** Greys carry the interface; the accent appears on the single primary action, and
    otherwise only as status or as chart data. The selected tab, the brand badge and the empty-state
    icon all gave up their colour, because each one was spending the accent on decoration.
  - **Borders.** Gone from cards, buttons, chips, inputs, pills and toasts. Hairlines survive in the
    two places they mean something: between rows in a list, and down the sidebar edge.
  - Labels are sentence case at normal tracking, `h1` is a 30px large title, and the spacing rhythm
    widened, since space is the separator now that the outlines are gone.
  - The palettes were rewritten as two deliberate designs rather than one inverted: dark puts
    lighter surfaces on a dark ground, light puts white surfaces on a grouped grey one. The work was
    cheap because the CSS was already fully tokenised - rewriting the tokens re-skinned every screen.
  - **Not verified by eye.** A build proves it compiles, not that it looks right: `npm run dev`, and
    check both themes, that the window still drags, and that the sidebar nav still clicks.
- **2026-09-17:** An Appearance setting, so the light design can actually be seen.
  - Lucas ran the overhaul and reported seeing "the basic theme we started with", and asked whether
    there should be a theme button. He was running it correctly: the app followed the desktop's
    appearance and had no override, so on a Mac in Dark Mode he saw the new *dark* palette - and old
    dark (`#0e1014`) against new dark (`#1c1c1e`) reads as "much the same" at a glance. The light
    half, which is where this design language actually shows, needed changing the whole computer's
    appearance to see. That is a bad way to review a design.
  - **Settings → Appearance**: Automatic, Light, Dark, as a segmented control. Automatic is the
    default and is exactly the old behaviour, so nothing changes for anyone who ignores it.
  - It works through `nativeTheme.themeSource`, which also decides what `prefers-color-scheme`
    reports to the page. So one line in main drives the whole UI and the renderer knows nothing
    about it. `SettingsService` takes it as an injected `applyAppearance`, keeping the service free
    of Electron imports like the others.
  - The choice is saved and re-applied at startup, or it would last only until the next restart.
  - **No settings file version bump**, deliberately: an unknown version reads as the defaults, so
    bumping it would have silently thrown away everyone's chosen mpv path in order to add a theme.
    A file written before the field existed still loads, and falls back to Automatic - proven by a
    test that writes a version 1 file with no `appearance` and checks the mpv path survives.
  - Found while adding those tests: the store's own tests only ever wrote the file directly *after*
    a save had created its folder, so a test that writes first failed on a missing directory rather
    than on what it was checking. The folder is now created in `beforeEach`.
  - 301 unit tests, up from 292. Nine new: four on the service, two on IPC validation, three on the
    store, including the two backward-compatibility cases above.
- **2026-09-17:** A lighter light mode. *Lucas: the themes work and look good, but light mode's
  background was "almost opaque" and wanted to be a touch whiter.*
  - He was right, and it was a wrong value rather than a matter of taste: `--bg` was `#ececf0`,
    noticeably greyer than macOS's own grouped background. It is now `#f2f2f7`, the system value.
  - **The catch, and why this was not a one-line change.** The cards have no border - they are told
    apart from the background purely by being a lighter surface. Whitening the background shrinks
    that step, so cards would have started dissolving into it. A new `--card-shadow` token carries
    the separation instead: `none` in dark, where lightness already does the job, and barely-there
    in light. Lift, not outline, which is how the system handles the same problem.
  - Checked before changing the value: `--bg` is used in exactly one place (`body`), and the
    `--raised` surfaces sit on white panels rather than on the background, so nothing else washed
    out. The toast floats over the background but carries its own shadow already.
  - No behaviour change, so no new tests: 301 unit tests, 308 with the real-mpv set, lint and
    typecheck clean.
