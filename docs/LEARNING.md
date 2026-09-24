# Learning log

What building FileShuffler has taught, written to be read back later. `PROJECT.md` records
*what* was decided and when; this file records *why it works that way*, what the alternatives were,
and the idea underneath each one - the part worth carrying into the next project.

How it grows: every branch in the polish pass adds an entry to the [Log](#log) at the bottom, in
the format shown there. The sections above it are the big picture, and get corrected when the log
shows they were wrong.

**Contents**

1. [The shape of an Electron app](#1-the-shape-of-an-electron-app)
2. [FileShuffler's architecture](#2-fileshufflers-architecture)
3. [The pipelines](#3-the-pipelines)
4. [Lessons from building v1](#4-lessons-from-building-v1)
5. [Concepts to know](#5-concepts-to-know)
6. [Log](#log)

---

## 1. The shape of an Electron app

An Electron app is not one program. It is several processes, each with a different amount of trust,
talking to each other through messages:

| Process | Runs | Can touch files? | In FileShuffler |
| --- | --- | --- | --- |
| **Main** | Node.js | Yes - everything | `src/main/`: services, the shuffle, the player, the database |
| **Preload** | A small script between the two | Only what it is given | `src/preload/`: the bridge |
| **Renderer** | Chromium, like a web page | No | `src/renderer/`: the React UI |

The renderer is treated as untrusted even though we wrote it, because it renders content and runs
a big browser engine - if anything ever went wrong in there, the damage should stop at the window.
So it is **sandboxed** (no Node, no file access), and the only way it can ask main for anything is
through a short list of functions the preload script exposes as `window.api`. Main checks every
message it receives: that it came from our own window, and that its arguments are what they should
be, because types do not exist once data crosses a process boundary.

**The idea to keep:** put the line of trust somewhere deliberate, make the crossing narrow, and
check everything at the crossing.

## 2. FileShuffler's architecture

```
 renderer (React)            presentation only - shows state, sends intentions
       |  window.api.*       the narrow bridge (src/preload)
 main process
   |-- ipc.ts, *Ipc.ts           checks every message: right sender, right shape
   |-- app/*Service.ts            one service per area; no Electron imports
   |-- app/coordinator.ts         the one owner of "what is playing" and pending deletes
   |-- domain/shuffle.ts          pure logic: the shuffle-bag algorithm
   |-- playback/types.ts   -->  PlaybackAdapter
   |        |-- mpv/              a separate mpv window, over a local pipe
   |        +-- embedded/         a <video> in our own window
   +-- library/                   SQLite, running in a worker thread
```

Four decisions carry most of the weight:

- **Pure logic in the middle.** `domain/shuffle.ts` knows nothing about Electron, files or players.
  That is why it has deterministic tests for the awkward cases - the seam between two cycles, Back
  after a delete - which would be hard to reach through a UI.
- **Dependencies passed in, not reached for.** A service receives what it needs (`trash`,
  `launchPlayer`, `listVideos`...) as parameters. The app passes the real ones; tests pass fakes.
  This is *dependency injection*, and it is what makes 350 tests possible without opening a window.
- **One interface, several implementations.** The coordinator talks to "a player", never to mpv.
  When the built-in player arrived, it was a second implementation of `PlaybackAdapter` - and the
  coordinator, the shuffle and the delete flow did not change **at all**. That is the *adapter
  pattern* paying for itself.
- **Explicit state, and tokens against late news.** Every load gets a token, every unload a request
  ID. If Next is pressed twice, the first file's late "I've ended" arrives carrying an old token and
  is ignored, instead of skipping a second file.

## 3. The pipelines

"Pipeline" here means a repeatable sequence of steps. None of these run automatically yet - there is
no CI (nothing runs on GitHub when a PR opens). That gap is the first item for the polish pass.

**Build** - `npm run build:win` / `npm run build:mac`
1. `typecheck` - TypeScript checks the whole program before anything is built.
2. **electron-vite** bundles *three* programs into `out/`, one per process from section 1.
3. **electron-builder** packs them into `app.asar` (an archive the app reads from) and wraps that in
   an installer: an NSIS `.exe` on Windows, a `.dmg` on macOS.
4. `npm run licenses` copies Chromium's licence notices next to the installer.

*Lesson:* the builder packs **the whole project folder** unless told what to leave out. That is how
a Mac build once shipped a full old copy of itself and `docs/PROJECT.md` inside the app (#48). The
exclusion list in `electron-builder.yml` is a security control, not tidying.

*Try it:* after a build, `npx @electron/asar list dist/win-unpacked/resources/app.asar` shows every
file the app actually ships - 26 of them.

**Icons** - `npm run icons`: one `build/icon.svg` becomes the `.ico`, `.icns` and two PNGs. One
source means the platforms cannot drift apart, and because the script writes the Mac format itself,
a Windows PC can rebuild the Mac icon.

**Release** - manual, steps in `PROJECT.md` "Resume here"
1. Build both platforms **from one commit** - that is what "the same release" means.
2. Create the release as a **draft**, so it is never public with a platform missing.
3. Upload each installer from the machine that built it (`gh release upload`).
4. **Download** it and install - not copy it. Only a downloaded file carries the *quarantine flag*
   that makes Windows SmartScreen and macOS Gatekeeper step in, which is the thing being tested.
5. Publish, then check it **logged out**: a draft is visible to its owner, so being logged in proves
   nothing about what a stranger gets.

**Verification** - the loop behind every change
1. `npm run lint`, `npm run typecheck`, `npm test`.
2. Run the real app and read its page through `--remote-debugging-port` (the same protocol browser
   dev tools use), so behaviour is checked without screenshots of your screen.
3. Point it at a throwaway copy of the data with `FILESHUFFLER_DATA`, never the real library.
4. For anything visual or timing-related, measure it - the theme-switch lag was found by sampling
   the window's pixels frame by frame.

*Lesson:* tests prove the logic; only running the app proves the product. Every serious bug in the
built-in player passed all the tests (section 4).

## 4. Lessons from building v1

**Measure before deciding.**
- "Can Chromium play the library?" - answered by decoding real files: 98.9% by size. `canPlayType`,
  the browser's own answer, was wrong twice: it said no to `.mov` and to Matroska, which both play.
- "Will an in-app player break deletes?" - answered by trashing a file while it played. It worked,
  so the risk everyone would have assumed was not there.
- "Why does the sidebar lag on a theme change?" - sampling pixels showed the page flipping in one
  frame and Windows fading its own material over 225ms. The cause was the operating system, which no
  amount of reading our code would have found.

**Some bugs only exist when the app runs.**
- `protocol.handle` was called before the app was ready - a startup crash no test could see.
- A `play()` refused because the window was in the background was reported as a *broken file*, and
  the shuffle skipped everything. A refusal and a failure are different things.
- The icon's small sizes were written as PNG, which looked fine in Explorer and came out as random
  noise through Windows' own icon loader.
- Twice, an empty black box: something shown before there was anything to show.

**Reversing a decision is part of the job.**
- New installs defaulted to the built-in player but upgrades kept mpv, to avoid surprising people.
  The one person who asked for the built-in player then got mpv. Good general instinct, wrong here.
- The translucent sidebar took two rounds to settle, because translucency and an instant theme
  switch turned out to be the same decision: any transparency hands part of the colour - and the
  timing - to the operating system.

**Security is design, not a feature.**
- The UI is handed a *token* for a video, never its path; main decides what the token means. Even a
  compromised page cannot ask for a file it was not given.
- Deletes only ever go to the Recycle Bin or Trash, fail closed, and wait out an undo window.

## 5. Concepts to know

- **Process isolation / sandboxing** - running untrusted code where it cannot reach the system.
- **IPC (inter-process communication)** - messages between processes; here, `ipcMain` and
  `ipcRenderer`, reached only through the preload bridge.
- **Context isolation** - the page and the preload script get separate JavaScript worlds, so the
  page cannot tamper with the bridge.
- **CSP (Content Security Policy)** - the page's own list of what it may load; ours allows scripts
  from itself and video from `fsvideo:` only.
- **Adapter pattern** - one interface, several interchangeable implementations.
- **Dependency injection** - passing in what code needs, so tests can pass something else.
- **Worker thread** - a second JavaScript thread; the database lives in one so a slow query cannot
  freeze the window.
- **asar** - Electron's archive format for the app's own files.
- **Code signing** - a certificate that says who made a program. **Notarization** is Apple checking
  it too. **SmartScreen** (Windows) and **Gatekeeper** (macOS) warn about programs without them.
- **Mark of the Web / quarantine flag** - the tag an OS puts on downloaded files; it is what makes
  those warnings appear.

---

## Log

One entry per branch in the polish pass, newest last:

```
### YYYY-MM-DD - Topic (PR #n)
- What changed:
- Why:
- Alternatives, and why not:
- The idea to keep:
- Try it: (optional - a small thing to run or read)
```

### 2026-09-24 - Starting this log

- What changed: this file.
- Why: v1 shipped, and the next stretch (polishing the pipeline, the code and the UI) is as much
  about understanding the project as improving it.
- Alternatives, and why not: a separate document outside the repo would not travel between the two
  machines with the code, and future sessions would not read it.
- The idea to keep: write down *why*, not just *what* - the *what* is already in git.
