---
name: fileshuffler-ui
description: Front-end conventions for the FileShuffler renderer - design tokens, the shape scale, motion values, focus and keyboard rules, and the Electron/CSP constraints that limit what the UI may use. Load before writing or changing anything under src/renderer/.
---

# FileShuffler UI

How the renderer looks and behaves. `PROJECT.md` holds the product decisions and `CLAUDE.md` the
code rules; this file is only about the front end.

Two kinds of entry live here, and they are labelled:

- **Recorded** - already true in the code, or a hard constraint. Follow it.
- **Open** - not settled yet. Lucas decides these; propose, show him, then move the entry to
  Recorded with the value he picked. The front end is where his taste decides, so do not quietly
  invent a convention and leave it in the code.

## Hard constraints (Recorded)

These come from the app's security baseline and safety rules, not from taste. They are not
negotiable without changing `PROJECT.md` §2 and §5.

- **No network calls, ever.** So no Google Fonts, no CDN scripts, no remote images. The CSP in
  `src/renderer/index.html` is `default-src 'self'; script-src 'self'; style-src 'self'
  'unsafe-inline'; img-src 'self' data:`. Anything fetched from outside is blocked, silently.
- **System fonts only**, already set on `:root`: `system-ui, -apple-system, 'Segoe UI', Roboto,
  sans-serif`. The app must look right on both macOS and Windows.
- **The renderer is presentation only.** No filesystem, Electron or player imports; everything goes
  through the preload bridge. A component that needs new data needs a new typed IPC call, not a
  shortcut.
- **`user-select: none` is set on `body`.** Turn it back on deliberately for anything a person would
  reasonably want to copy, such as a file path.
- Prefer plain CSS in `styles.css` over a new dependency. A UI library needs a real argument: it is
  bundle size and lock-in against the "no speculative frameworks" rule in `CLAUDE.md`.

## Tokens (Recorded)

Defined on `:root` in `src/renderer/src/styles.css`, with a light set under
`@media (prefers-color-scheme: light)`. **Always use the variable, never a raw hex value** - a
literal colour will be wrong in one of the two themes.

Surfaces `--bg`, `--panel`, `--raised`, `--sidebar`; fills `--selected`; lines `--border`,
`--border-strong`; text `--text`, `--muted`, `--faint`; accent `--accent`, `--accent-hover`,
`--accent-text`, `--accent-soft`; status `--danger`, `--danger-soft`, `--warning`, `--success`; plus
`--shadow` and `--card-shadow`.

Any new colour is added to **both** blocks in the same commit.

**Both palettes are designed, not derived** *(Lucas, 2026-09-17)*. Light is not the dark one
inverted: in dark, surfaces are *lighter* than the background; in light, a grouped grey background
sits behind *white* surfaces. Check a change in both before calling it done.

**Near-monochrome** *(Lucas, 2026-09-17)*. Greys carry the interface. `--accent` appears on the one
primary action and nowhere else, and colour otherwise means status only - playing, warning, danger,
or a category in a chart, where the colour *is* the data. Adding a coloured element anywhere else
spends the accent on decoration, and then it stops meaning "this is the thing to do".

**Separate with surfaces and space, not outlines.** `--border` is a translucent hairline, used
between rows in a list and down the sidebar edge - never wrapped around a card, button, chip, input
or pill. Drawing a box around everything is what made this app read as a generic dashboard.
`--selected` is the neutral fill for a control or a selected row.

**When a surface alone is not enough, lift it - never outline it.** In light mode the background is
close to white, so a white card has little contrast to rely on and no border to fall back on;
`--card-shadow` carries that separation instead, and is `none` in dark, where lightness already does
the job. Reach for a shadow before ever reaching back for a border, and keep it barely visible.

Changing a surface token means checking what else sits on it. `--bg` is used only by `body`, but the
`--raised` surfaces sit on white panels rather than on the background, so they are unaffected by a
background change - that is the kind of thing to confirm before picking a new value, not after.

## Shape (Recorded)

The radii in use, smallest to largest: `5px` for keycaps, `7px` for selects and small marks, `8px`
for buttons and nav items, `9px` for inputs and inline chrome, `12px` for grouped rows, `14px` for
toasts, `16px` for cards, `999px` for pills and bars, `50%` for circular marks. Pick the nearest
existing value rather than adding a new one.

Type carries the hierarchy now that the outlines are gone: a 30px large title against 13px secondary
text. If a layout is not reading clearly, widen the type jump or the spacing before reaching for a
line or a box.

## Window chrome (Recorded)

macOS hides the title bar (`titleBarStyle: 'hiddenInset'`) so the sidebar runs to the top edge, and
the window is vibrant behind it. Three things follow, and each one silently breaks something if
forgotten:

- **The sidebar is the drag handle** (`-webkit-app-region: drag`), so every control anywhere inside
  it must opt back out. A blanket `no-drag` on `button, select, input, a, [role="button"]` covers
  this; a new interactive element that is not one of those needs it added, or it will look fine and
  simply not respond to clicks.
- **The traffic lights float over the top-left of the sidebar**, so `.is-mac` adds top padding to
  the sidebar and to `.main`. That class is set in `main.tsx` from the user agent, because the
  renderer has no Node access.
- **`--sidebar` is transparent on macOS** so the vibrancy shows. Give it a real surface on any
  platform that has no window material.

`mainWindow.ts` owns this, and `backgroundColor` follows `nativeTheme` - it was hard-coded dark,
which flashed dark at every launch for a light-mode user.

**Windows keeps its normal frame** and takes only the Mica material. Hiding the title bar there
means drawing the window controls with `titleBarOverlay` and reserving space for them, which cannot
be verified from a Mac. Finish that in a Windows session rather than guessing.

## Appearance (Recorded)

Settings → Appearance offers Automatic, Light and Dark. Automatic is the default and follows the
desktop, which is what the app did before the setting existed.

It works through `nativeTheme.themeSource` in main, which also decides what `prefers-color-scheme`
reports to the page. **So the renderer needs no theme state at all**: keep it that way, and never
add a class or a context to track the theme - write the two palettes and let the media query do it.
`SettingsService` receives it as an injected `applyAppearance`, so the service keeps no Electron
import.

Use it when checking a change in both themes: that is what it is for, and it beats changing the
whole computer's appearance to review a screen.

## Motion

**Recorded - the tokens.** Defined on `:root` in `styles.css`. Use them; never write a raw duration
or easing into a rule.

- `--dur-fast` 140ms - hover, colour and press feedback
- `--dur-base` 220ms - something entering the screen
- `--dur-slow` 320ms - larger surfaces, such as a toast
- `--spring` - a real spring with a small overshoot, written as `linear()` inside an `@supports`
  test, with a `cubic-bezier` fallback. It has to be `@supports` rather than two declarations: a
  custom property is not validated until it is used, so an unsupported `linear()` would make every
  rule using the property invalid instead of falling back.
- `--ease-out` - settles straight onto its value. For anywhere an overshoot would misread, such as
  `.progress-fill`, where it would look like the bar passing 100%.

**Recorded - where motion is used, and only there** *(Lucas, 2026-09-17: springs on the moments that
matter, nothing anywhere else)*:

- `.now-title` - the filename changing is what the Shuffle screen exists for
- `.controls`, `.hints` - arriving once playback starts
- `.banner` - errors and confirmations, which arrive unannounced
- `.toast` - the undo window, the one moment with a deadline attached
- `.btn:active` - press feedback, 60ms down and a spring back

Everything else stays still on purpose, and nothing loops or pulses: a permanent animation is the
kind you notice twice and resent by the twentieth time.

**Recorded - how it is triggered.** Animations run on mount, so React mounting or remounting an
element plays them and a changing `key` restarts them. That is why Next pressed twice quickly
restarts the title cleanly instead of queueing, and it keeps timing state out of the renderer, which
has no tests.

**Recorded - rules that hold regardless of taste:**

- **Animate `transform` and `opacity`.** They run on the compositor. Avoid animating `width`,
  `height`, `top` or `left`, which force layout on every frame. `.progress-fill` animating `width`
  is an accepted exception: width *is* the meaning there, and it changes at most a few times a
  second.
- **Every animation needs a `prefers-reduced-motion: reduce` escape.** There is now a blanket one at
  the end of `styles.css` cutting every duration to 1ms. State still changes; it just arrives
  instantly. Keep new animations inside that guarantee rather than opting out of it.
- **Motion must not delay a result.** Never gate a state change behind an animation finishing. This
  matters most for the delete undo window, which is safety-critical: the countdown is real time, not
  an animation.
- **Interruptible.** If something can be triggered twice quickly - Next, Back, switching tabs - the
  animation must survive being restarted mid-flight without flashing or queueing.
- Keep focus rings instant. Never transition an `outline`.

**Open - exit animations.** An element React unmounts leaves instantly, because nothing keeps it on
screen long enough to animate out. Adding that needs a small presence hook, which would put timing
state in the undo path - the one that gates file deletion - in a renderer with no tests. Decide
after seeing the entrances running, and never at the cost of delaying the undo itself.

## Focus and keyboard (Recorded)

- Focus ring is `outline: 2px solid var(--accent)` with `outline-offset: 2px` on buttons and nav
  items, `1px` on chips, selects and the search field. Use `:focus-visible`, not `:focus`, so a
  mouse click doesn't draw a ring.
- Every control reachable by keyboard, in a sensible order. Icon-only buttons need an `aria-label`.
- Live regions already in use: `role="alert"` for errors, `role="status"` for progress and notices.
- Player shortcuts belong in `hooks/useShortcuts.ts`. Plain arrows and Delete are never registered
  as global shortcuts (`CLAUDE.md`).

## Icons (Recorded)

All icons live in `components/Icons.tsx` and go through the local `Svg` wrapper: `24x24` viewBox,
`fill="none"`, `stroke="currentColor"`, `strokeWidth={2}`, round caps and joins, default size `18`,
`aria-hidden="true"`. Colour comes from `currentColor`, so never hard-code a stroke colour. Add new
icons in that file in the same style; don't add an icon dependency.

## Adding a screen (Recorded)

A screen is a tab in the sidebar. Four places change together:

1. `components/Sidebar.tsx` - add to the `Page` union and add a `nav-item` button with an icon.
2. `App.tsx` - route to the new component, passing the hook data it needs.
3. `components/<Name>Screen.tsx` - a `.screen` wrapper with a `.screen-header` holding an `<h1>`
   and any screen-level actions.
4. `styles.css` - only if genuinely new styling is needed; reuse `.card`, `.dash-section`,
   `.section-title`, `.sub-title`, `.files`, `.list-foot`, `.banner` first.

Hooks stay subscribed for the whole session on purpose (see the comment in `App.tsx`), so switching
tabs shows current state instead of reloading - a shuffle keeps running while another tab is open.
Don't move a hook inside a screen component.

## Open questions that shape the front end

- **The player.** `PROJECT.md` §9 item 5: mpv's own window is what Lucas finds ugly, and no amount
  of polish in these screens changes that video opens in a separate, unstyled window. Chromium
  `<video>` versus embedded libmpv is unresolved, and the answer decides whether there is ever a
  playback surface to design here.
- **Density and layout.** Nothing is settled about spacing scale, list density, or whether the
  dashboard should stay one long scroll. Ask before committing to one.
