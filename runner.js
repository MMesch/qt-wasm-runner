// qt-wasm-runner: fetch an emscripten-forge Qt6-wasm package as .tar.bz2,
// extract it entirely in the browser, and boot the app.
//
// Uses @emscripten-forge/untarjs for bz2 decode + tar walk. The extracted
// contents are turned into blob: URLs so Qt's loader can fetch them without
// touching the network.

import { initUntarJS } from "https://esm.sh/@emscripten-forge/untarjs@5.3.3";

// Point untarjs's internal Emscripten module at unpack.wasm via a proper
// URL. Its bundled default is a raw Uint8Array of the wasm bytes, which
// only works when a bundler pre-processes it; via esm.sh, Emscripten later
// calls startsWith() on those bytes and crashes. Hosting the sidecar on
// jsdelivr (CORS-friendly, immutable versioned URL) avoids that.
const UNTAR_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@emscripten-forge/untarjs@5.3.3/lib/unpack.wasm";

const statusEl  = document.getElementById("status");
const screenEl  = document.getElementById("screen");
const urlInput  = document.getElementById("url");
const runBtn    = document.getElementById("load");
const fileInput = document.getElementById("file");

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

// A conda .tar.bz2 lays out installable files under a per-app path like
// `share/qt-calculator/{qt-calculator.wasm, qt-calculator.js, qt-calculator.html, qtloader.js}`.
// Find the app directory by locating the sole share/*/ *.wasm file.
function findAppDir(files) {
  const wasmPaths = Object.keys(files).filter(
    p => p.endsWith(".wasm") && p.startsWith("share/")
  );
  if (wasmPaths.length === 0) {
    throw new Error("no share/*/ *.wasm file in the package");
  }
  if (wasmPaths.length > 1) {
    console.warn("multiple wasm files found, picking first:", wasmPaths);
  }
  const wasm = wasmPaths[0];
  const dir = wasm.slice(0, wasm.lastIndexOf("/"));       // e.g. "share/qt-calculator"
  const name = wasm.slice(dir.length + 1, -".wasm".length); // e.g. "qt-calculator"
  return { dir, name };
}

// source is either a URL string (fetched by untarjs) or a Uint8Array
// (already-loaded bytes from a File/drop). untarjs 5.3.3 exposes two
// separate methods: extract(url) fetches then extracts, extractData(bytes)
// works on already-loaded bytes.
async function run(source, label = String(source)) {
  runBtn.disabled = true;
  try {
    setStatus(`loading ${label}…`);

    const untarjs = await initUntarJS(() => UNTAR_WASM_URL);
    const files = typeof source === "string"
      ? await untarjs.extract(source)
      : await untarjs.extractData(source);
    setStatus(`extracted ${Object.keys(files).length} files, locating app…`);

    const { dir, name } = findAppDir(files);
    setStatus(`booting ${name}…`);

    // Build a base-name → blob: URL map for everything in the app dir.
    // Qt's loader will look up `<name>.wasm` by base name, so this makes
    // its file-fetching work without any real HTTP.
    const blobs = {};
    for (const [path, bytes] of Object.entries(files)) {
      if (!path.startsWith(dir + "/")) continue;
      const rel = path.slice(dir.length + 1);
      blobs[rel] = URL.createObjectURL(new Blob([bytes]));
    }

    if (!blobs[`${name}.js`] || !blobs["qtloader.js"]) {
      throw new Error(`missing ${name}.js or qtloader.js in package`);
    }

    // Load qtloader.js first (defines global qtLoad).
    await loadScript(blobs["qtloader.js"]);
    // Then the app's emscripten glue (defines global <name>_entry).
    await loadScript(blobs[`${name}.js`]);

    const entryName = name.replaceAll("-", "_") + "_entry";
    const entry = window[entryName];
    if (typeof entry !== "function") {
      throw new Error(`emscripten entry ${entryName} not found on window`);
    }

    await window.qtLoad({
      qt: {
        // Wrap Emscripten's entry so locateFile resolves to our blob URLs
        // — the wasm fetch goes there instead of the real network.
        entryFunction: (config) =>
          entry({
            ...config,
            locateFile: (fname) => blobs[fname] ?? fname,
          }),
        containerElements: [screenEl],
        onLoaded: () => setStatus(`running ${name}`),
        onExit: (e) =>
          setStatus(`${name} exited: ${e.text ?? "code " + e.code}`, e.crashed),
      },
    });

    // Qt-wasm sometimes doesn't commit its initial canvas paint until it
    // receives a resize event (bug we hit with the qt-hello demo). Fire a
    // couple of synthetic resizes after boot to force the first frame.
    setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
    setTimeout(() => window.dispatchEvent(new Event("resize")), 500);

    setStatus(`running ${name}`);
  } catch (err) {
    console.error(err);
    setStatus(`error: ${err.message ?? err}`, true);
    runBtn.disabled = false;
  }
}

async function runFromFile(file) {
  setStatus(`reading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MiB)…`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return run(bytes, file.name);
}

// UI wiring.
runBtn.addEventListener("click", () => {
  const url = urlInput.value.trim();
  if (url) run(url);
});
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runBtn.click();
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) runFromFile(file);
});

// Full-page drag & drop.
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  if (++dragDepth === 1) document.body.classList.add("dragging");
});
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
window.addEventListener("dragleave", (e) => {
  e.preventDefault();
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove("dragging");
  }
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  const file = e.dataTransfer?.files?.[0];
  if (file) runFromFile(file);
});

// Deep-link support: ?pkg=<url> autostarts.
const params = new URLSearchParams(location.search);
const pkgUrl = params.get("pkg");
if (pkgUrl) {
  urlInput.value = pkgUrl;
  run(pkgUrl);
}
