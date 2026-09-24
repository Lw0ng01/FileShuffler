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
6. [How work gets done](#6-how-work-gets-done)
7. [Log](#log)

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

"Pipeline" here means a repeatable sequence of steps. Only one runs by itself: **CI**, which runs on
GitHub for every push. The rest are run by hand.

**CI** - `.github/workflows/ci.yml`, on every push
1. Two fresh machines start on GitHub, one Windows and one macOS.
2. Each one runs `npm ci`, `lint`, `typecheck`, `test` and a build - the same checks as before a
   local commit.
3. The result shows as a green tick or a red cross next to the commit and on the PR.

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
- **CI (continuous integration)** - running the checks automatically on every push, on clean
  machines, so "it passed" does not depend on anyone remembering.
- **Refactor** - changing how code is arranged without changing what it does. The proof is that
  the output is identical before and after.
- **Dead code** - code nothing can reach. It still costs: it gets read, maintained, and sometimes
  (like the bundled-mpv lookup) quietly does something nobody meant.
- **Cyclomatic complexity** - a count of the paths through a function; a hint where code may be
  hard to follow, not a verdict.

## 6. How work gets done

The same loop runs for every change, whichever machine it's on. Each step exists because skipping
it once caused a problem.

1. **Start from the latest `main`.** `git fetch`, check the previous branch was merged, then a new
   branch named `worktree-<topic>`. One topic per branch, so each PR can be reviewed, merged or
   reverted on its own.
2. **Look before changing.** Read the code and the relevant docs first (the UI skill before any
   screen change). For a clean-up, measure first - `knip` for unused code, ESLint's `complexity`
   rule for tangled functions - rather than going on a feeling.
3. **Make the change, with tests for the logic.** Anything pure (the shuffle, formatting, parsing)
   gets a test beside it. Screens have no tests, so they are checked by running them (step 5).
4. **Run the local checks:** `npm run lint`, `npm run typecheck`, `npm test`. Prettier on the files
   touched - and only those, so the diff shows the change and nothing else.
5. **Run the real app** against a throwaway data folder (`FILESHUFFLER_DATA`), and read the page
   through `--remote-debugging-port`: click through the change, read the text back, take a
   screenshot of the app's own page (never the whole screen). Both themes for anything visual.
   Delete the throwaway folder afterwards.
6. **Write it down.** `PROJECT.md` gets the decision and its date (Resume here + Change Log), this
   file gets the why (a Log entry), and `CLAUDE.md` or the UI skill get any new convention.
7. **Commit and push** as the author, with a message that says what changed and why - after
   scanning the diff for anything personal (emails, local paths, real file names).
8. **Wait for CI to go green** on both Windows and macOS, then hand over the PR link.
9. **Review, merge, try it.** The merge is a person's decision, and so is "does it actually feel
   right" - which is why the loop ends with you using it, not with the tests passing.

**For a refactor, add a before-and-after.** Capture what the user sees before changing anything,
change the code, capture again, and compare. If they are identical, the refactor changed nothing it
shouldn't have; if not, the difference is exactly what to look at.

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

### 2026-09-24 - CI on GitHub Actions

- What changed: `.github/workflows/ci.yml`. On every push, GitHub starts one Windows and one macOS
  machine, and each runs `npm ci`, lint, typecheck, the tests and a build. The result is a tick or
  a cross on the PR.
- Why: the checks already existed, but they ran only on the machine that made the change, and only
  when remembered. A change made on the Mac was never tested on Windows before merging. Several v1
  bugs were exactly that: code that was fine on one OS and wrong on the other.
- How to read it:
  - **Workflow**: the whole file. **Trigger** (`on:`): when it runs. **Job**: one machine's work;
    the **matrix** runs the same job once per OS. **Step**: one command.
  - `npm ci`, not `npm install`: it installs exactly what `package-lock.json` says and fails if the
    lockfile is out of date, so CI tests what is committed rather than whatever is newest today.
  - `fail-fast: false`: if Windows fails, macOS keeps going, so you learn whether the failure is
    Windows-only.
- Alternatives, and why not:
  - Only one OS: cheaper, but the bugs it would miss are the kind this project actually had.
  - Also building the installers in CI: slow, and a release is built and download-tested by hand
    anyway. Left for later, if it is ever wanted.
- Security, because a workflow is code that runs with access to the repository:
  - `permissions: contents: read`: the job can read the code and nothing else - it cannot push,
    tag, or edit releases.
  - Actions pinned by commit SHA (`actions/checkout@3d3c42e…`), not by tag (`@v7`): a tag can be
    moved to different code later, and a SHA can't. This is how several real supply-chain attacks
    worked - someone re-pointed a popular action's tags at malicious code.
  - `persist-credentials: false`: the checkout doesn't leave the access token lying around for
    later steps.
- The idea to keep: automate the check you already do by hand, and run it where your users are -
  here, both operating systems. A check that depends on remembering will be skipped one day.
- Try it: on a scratch branch, change an `expect(...)` in `src/main/domain/shuffle.test.ts` so it
  fails, push, and watch the PR turn red (`gh run watch` in a terminal, or the Actions tab). Open
  the failed step to see the same output `npm test` gives locally. Then delete the branch.

### 2026-09-24 - UI/UX fixes

- What changed:
  - A first-run card on the Dashboard: it names the folders a scan will read, and has Scan, Choose
    different folders, and a pointer to Shuffle.
  - Switching tabs scrolls back to the top.
  - Settings shows mpv's setup only when mpv is the chosen player.
- Why: each one is something a stranger meets in their first minute, and that only you had stopped
  seeing. The app already *had* a friendly empty state - it just never appeared, because startup
  adds the standard folders, so "no folders" was never true for a real new user. The empty state
  was designed for a state the app never reaches.
- Alternatives, and why not:
  - Scan automatically on first launch: fewer clicks, but reading someone's Documents and
    Downloads before they have asked is not how this app treats their files. It says what it will
    read and waits.
  - Remember each tab's scroll position instead of resetting it: more code, and the screens change
    under you anyway (a scan finishes, a list grows), so the old position often isn't meaningful.
- Found along the way: the testing switch `FILESHUFFLER_DATA` quietly copied the real development
  library into the "empty" test folder, because an old migration ran first. The test would have
  "passed" on a state that wasn't a first run at all. It was caught only because the result looked
  wrong - the card should have been there and wasn't.
- The idea to keep: **test the state users actually start in, not the one you imagine.** Empty
  states and first runs are the easiest screens to get wrong, because developers never see them
  again after day one. And when a test setup is meant to be isolated, check that it is - print
  what it actually loaded before trusting what it shows.
- Try it: `FILESHUFFLER_DATA=<an empty folder> npm run dev` shows the app exactly as a new user
  sees it. Delete the folder afterwards.

### 2026-09-24 - Code health pass

- What changed:
  - Removed the lookup for an mpv "bundled with the app" - mpv was never bundled - along with its
    Settings label and the option that fed it.
  - Settings split from one 364-line component into a layout plus one file per section in
    `components/settings/`, with the two identical pickers made one `Segmented` component.
  - Four exports nothing imported became file-private, and comments that still promised a VLC
    player were rewritten to describe the two players that exist.
- How it was measured, not guessed:
  - **Size**: no file is alarming. The largest is 737 lines, most of it SQL, in a 10,000-line app.
  - **Unused code**: `knip`. Run naively it said half the app was unused, because it didn't know
    Electron has four entry points (main, preload, renderer, the database worker). Told about
    them, it found 4 unused exports and no unused files or dependencies.
  - **Tangle**: ESLint's `complexity` rule. It flagged `getView` at 22 - but that function is a
    list of `?? default` fallbacks, each of which counts as a branch, and it reads straight down.
    It also flagged `SettingsScreen` - which really was five screens' worth of markup in one
    function. Same number, different verdicts.
- Why the dead code mattered more than it looked: the Windows install folder is writable by the
  user, so "look for `resources/mpv/mpv.exe`" meant anything that dropped a file there would be run
  as the video player. Code that "does nothing" was a small hole. The test now checks the opposite
  of what it used to: that nothing inside the app's folder is ever looked at.
- How the refactor was proven safe: the Settings page's HTML was saved before the split in three
  states (Built-in, mpv, a Clear… confirmation open), then saved again after. Byte-for-byte
  identical. There are no screen tests, so this was the test.
- Alternatives, and why not:
  - Split the other big files too (`indexDb.ts`, `indexerService.ts`): they are long, but each is
    one idea in one place. Splitting them would scatter it without making anything clearer.
  - Turn the complexity rule on permanently: it would flag the fallback lists forever and teach
    everyone to ignore it. A tool you run when you want an answer beats a warning nobody reads.
- The idea to keep: **measure, then judge.** Tools find candidates quickly; deciding which are real
  problems takes reading the code. And a refactor is only safe if you can show nothing changed.
- Try it: `npx knip` in the project, and see how much it wrongly calls unused without being told
  the entry points - then compare with the list above.
