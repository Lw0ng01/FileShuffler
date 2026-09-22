# Third-party notices

FileShuffler itself is MIT licensed (see [LICENSE](LICENSE)). The downloadable builds also contain
software written by other people, under their own licences, and those licences require their notices
to travel with the binaries. This file is that notice.

Nothing here applies to the source in this repository on its own - only to a packaged build, which
embeds a copy of Electron and Chromium.

## Electron

Electron is distributed under the MIT licence.

```
Copyright (c) Electron contributors
Copyright (c) 2013-2020 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Chromium and its own dependencies

Electron embeds Chromium, which is not under a single licence. It ships an aggregate credits
document listing every component it contains - several hundred of them, under BSD, MIT, Apache 2.0
and others - each with its own copyright notice.

That document is **`LICENSES.chromium.html`**, about 19 MB, and it is the notice for all of them. It
is too large to keep in this repository, and paraphrasing it would be both incomplete and wrong, so
it is published **alongside the installers on each
[release](https://github.com/Lw0ng01/FileShuffler/releases)**.

`npm run build:mac` and `npm run build:win` write it into `dist/` next to the installer, along with
Electron's own `LICENSE`; `npm run licenses` produces them on their own. Both belong on the release.
They sit beside the installer rather than inside it: the licences ask that the notice accompany the
distribution, and bundling 19 MB into every download would add a sixth to its size for a file nobody
opens twice.

If you have a build and want the exact file for its version, it is also inside the official Electron
distribution for that version, at the root of
`electron-v<version>-<platform>-<arch>.zip` from
[electron/electron releases](https://github.com/electron/electron/releases).

## mpv

**mpv is not bundled.** FileShuffler can use an mpv you have installed yourself, but ships no part of
it, so mpv's GPL terms do not reach this project or its builds. If you install mpv, it stays under
its own licence, wherever you got it from.

## React

React and React DOM are MIT licensed (Copyright (c) Meta Platforms, Inc. and affiliates) and are
compiled into the application bundle.
