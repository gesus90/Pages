import type { ConversationWebPackageManifest } from "@/definition/ConversationInteractiveContent";

/** The name of the entry page every player starts with. */
export const PLAYER_ENTRY_NAME = "index.html";

/** The name of the start script Pages writes for the entry page. */
export const PLAYER_BOOT_NAME = "pages-player.js";

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/gu,
    (character) => HTML_ESCAPES[character] ?? "",
  );
}

/**
 * The policy of every answer of a player.
 * @param frameAncestor - The origin of Pages that may frame the player;
 * `'self'` when the player runs on the origin of Pages.
 * @returns The `Content-Security-Policy` header.
 * @remarks
 * The player loads scripts, the module and its data only from its own
 * package and reaches no other address: no request leaves the package, no
 * form is sent and no other page frames it.
 */
export function playerPolicy(frameAncestor: string): string {
  return [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${frameAncestor}`,
  ].join("; ");
}

/**
 * The entry page of a player: a full canvas, the engine script of the
 * package and the start script of Pages. The page of the export itself is
 * never served.
 * @param manifest - The checked manifest of the package.
 * @returns The HTML document.
 */
export function playerEntryDocument(
  manifest: ConversationWebPackageManifest,
): string {
  const title = escapeHtml(manifest.title ?? manifest.executable);
  const engine = escapeHtml(`${manifest.executable}.js`);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<style>
html, body { margin: 0; height: 100%; overflow: hidden; background: #000; color: #fff; font: 14px system-ui, sans-serif; }
#canvas { display: block; width: 100%; height: 100%; outline: none; }
#pages-player-status { position: absolute; inset: auto 0 0 0; padding: 8px 12px; background: rgba(0, 0, 0, 0.72); }
#pages-player-status[hidden] { display: none; }
</style>
</head>
<body>
<canvas id="canvas" tabindex="0">HTML5 canvas</canvas>
<div id="pages-player-status" role="status">…</div>
<script src="${engine}"></script>
<script src="${PLAYER_BOOT_NAME}"></script>
</body>
</html>
`;
}

/**
 * The start script of a player: it checks what the browser offers and
 * starts the engine with the files of the package only.
 * @param manifest - The checked manifest of the package.
 * @returns The JavaScript source.
 * @remarks
 * The engine keeps nothing between starts (no persistent paths, no dropped
 * files kept) and asks for no isolation headers, since the single-threaded
 * build needs no shared memory.
 */
export function playerBootScript(
  manifest: ConversationWebPackageManifest,
): string {
  const sizes = Object.fromEntries(
    manifest.files.map((file) => [file.path, file.sizeBytes]),
  );
  const config = {
    executable: manifest.executable,
    mainPack: `${manifest.executable}.pck`,
    fileSizes: sizes,
  };
  // The JSON is a literal of the script; `<` cannot end the script element.
  const literal = JSON.stringify(config).replace(/</gu, "\\u003c");
  return `(function () {
  "use strict";
  var config = ${literal};
  var isGerman = String(navigator.language || "").toLowerCase().indexOf("de") === 0;
  var status = document.getElementById("pages-player-status");
  function show(german, english) {
    status.textContent = isGerman ? german : english;
    status.hidden = false;
  }
  // A frame with an opaque origin refuses service workers, and the engine
  // would report reading them as an error; the player registers none.
  try {
    void navigator.serviceWorker;
  } catch (error) {
    try {
      delete Navigator.prototype.serviceWorker;
    } catch (ignored) {}
  }
  if (typeof Engine === "undefined") {
    show("Die Engine des Pakets konnte nicht geladen werden.", "The engine of the package could not be loaded.");
    return;
  }
  var missing = Engine.getMissingFeatures({ threads: false });
  if (missing.length > 0) {
    show("Dieser Browser kann die Szene nicht ausführen: " + missing.join(", "), "This browser cannot run the scene: " + missing.join(", "));
    return;
  }
  var engine = new Engine({
    canvas: document.getElementById("canvas"),
    executable: config.executable,
    mainPack: config.mainPack,
    fileSizes: config.fileSizes,
    args: [],
    canvasResizePolicy: 2,
    focusCanvas: true,
    persistentPaths: [],
    persistentDrops: false,
    ensureCrossOriginIsolationHeaders: false,
    experimentalVK: false,
    gdextensionLibs: [],
    serviceWorker: ""
  });
  var isRunning = false;
  show("Szene lädt …", "Loading scene …");
  engine.startGame({
    onProgress: function (current, total) {
      // The engine may report its last progress after it started.
      if (isRunning || total <= 0) return;
      var percent = Math.round((current / total) * 100);
      show("Szene lädt … " + percent + " %", "Loading scene … " + percent + " %");
    }
  }).then(function () {
    isRunning = true;
    status.hidden = true;
    document.getElementById("canvas").focus();
  }, function (error) {
    var reason = error && error.message ? error.message : String(error);
    show("Die Szene konnte nicht starten: " + reason, "The scene could not start: " + reason);
  });
})();
`;
}
