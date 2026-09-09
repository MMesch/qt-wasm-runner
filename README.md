# qt-wasm-runner

A tiny in-browser runner for Qt6-wasm apps packaged on
[emscripten-forge](https://emscripten-forge.org/). Paste a `.tar.bz2` URL
(from prefix.dev or anywhere serving CORS-friendly conda packages), the
runner fetches it, unpacks it in the browser, and launches the Qt app
against a canvas — no server-side work, no install.

Live: https://mmesch.github.io/qt-wasm-runner/

## Usage

### Interactive
Three ways to load a package:

1. **URL**: paste `https://repo.prefix.dev/emscripten-forge-4x-experimental/emscripten-wasm32/qt-calculator-0.1.0-hXXXXXXX_0.tar.bz2` into the top bar and press **Run URL**.
2. **File picker**: click **Choose file…** and pick a local `.tar.bz2` (e.g. one you just built with rattler-build).
3. **Drag and drop**: drop a `.tar.bz2` anywhere on the page.

### Deep-link
Append `?pkg=<url-encoded package URL>` to auto-load:

```
https://mmesch.github.io/qt-wasm-runner/?pkg=https%3A%2F%2Frepo.prefix.dev%2Femscripten-forge-4x-experimental%2Femscripten-wasm32%2Fqt-calculator-0.1.0-hXXXXXXX_0.tar.bz2
```

## Requirements

- **Browser JSPI support**: Chrome 137+, Firefox 141+, or Safari 18.4+.
  Qt6-wasm on emscripten-forge uses JavaScript Promise Integration for
  its event loop; older browsers won't run the demos.
- **CORS**: the origin serving the `.tar.bz2` must allow cross-origin
  fetches. `repo.prefix.dev` does; some other channels may not.

## How it works

1. `@emscripten-forge/untarjs` decodes bzip2 + walks tar entries into a
   `{path: Uint8Array}` map, entirely in the browser.
2. The runner locates the app under `share/<name>/` (looks for the sole
   `share/*/ *.wasm` file), then wraps every file in the app dir as a
   `blob:` URL.
3. Qt's `qtloader.js` and the app's `<name>.js` emscripten glue are
   loaded as `<script>` tags from those blob URLs.
4. `qtLoad({...})` is called with the app's `_entry` factory and a
   `locateFile` hook that resolves further requests (`<name>.wasm`,
   etc.) back to blob URLs — no further network traffic.
5. Two synthetic `resize` events are dispatched shortly after boot to
   work around a Qt6-wasm quirk where the first paint doesn't commit
   until a resize.

## Not supported (yet)

- **Continuous animation** at 60fps: Qt-wasm timer-driven animation
  under JSPI can starve the browser main thread. Static/event-driven
  UIs (calculator, editors, viewers) work fine; games and animated
  demos need care.
- **Dynamic side-module deps**: this runner only knows about the app's
  own artifacts. If a Qt app pulls in a runtime `.so` (e.g. openblas as
  a side module), the runner would need to extract those into
  Emscripten MEMFS at the expected path — TODO.
- **`.conda` packages**: only `.tar.bz2` today. `.conda` is a zstd-inside-zip
  format that would need additional decoders.

## License

- Runner code (this repo): MIT.
- Qt (loaded from the packages): LGPLv3, © The Qt Company. Qt source and
  recipes are open on [emscripten-forge/recipes](https://github.com/emscripten-forge/recipes).
