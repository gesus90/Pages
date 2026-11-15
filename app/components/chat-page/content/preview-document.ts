import { companionRole, previewKindOf } from "./preview-kinds";

import type { PreviewFile } from "./preview-kinds";

/**
 * The address of the empty frame document every HTML and SVG preview runs
 * in (PAGE-383). It carries a policy of its own, so a preview may load from
 * the network while the page of Pages keeps its strict policy.
 */
export const PREVIEW_FRAME_URL = "/chat/preview-frame";

/**
 * The sandbox of a preview frame: scripts, forms and dialogs, but neither
 * the own origin nor navigation of the page nor new windows. Without
 * `allow-same-origin` the frame has an opaque origin of its own and reaches
 * no cookie, no storage and no window of Pages.
 */
export const PREVIEW_SANDBOX = "allow-scripts allow-forms allow-modals";

/** The frame document reports that it waits for the preview. */
export const PREVIEW_READY_MESSAGE = "pages-preview:ready";
/** Pages hands the frame the document of the preview. */
export const PREVIEW_RENDER_MESSAGE = "pages-preview:render";
/** The preview asks to write a message into the chat. */
export const PREVIEW_SEND_MESSAGE = "pages-preview:send";

/** Longest text a preview may write into the chat. */
export const PREVIEW_SEND_MAXIMUM_LENGTH = 4000;

/** Time after an input of the person in which a preview may write, in ms. */
const INPUT_WINDOW_MS = 5000;
/** Shortest time between two messages of one preview, in ms. */
const SEND_INTERVAL_MS = 1000;

/**
 * The documented function `pages.chat.send(text)` of a preview (PAGE-383).
 *
 * @remarks
 * It works only right after a click or an input of the person in the
 * preview: the frame remembers the last trusted input, and Pages checks
 * again in the page itself that the person just used this frame. It
 * returns `true` when the message was handed to Pages. The preview has no
 * other function of Pages.
 */
const BRIDGE_SCRIPT = `<script>(function(){
var lastInput=0;
["pointerdown","pointerup","click","keydown","keyup","input","change","submit"].forEach(function(type){
window.addEventListener(type,function(event){if(event.isTrusted)lastInput=Date.now();},true);});
function send(text){
if(typeof text!=="string"||text.trim()==="")return false;
var activation=navigator.userActivation;
var isActive=activation?activation.isActive:Date.now()-lastInput<${String(INPUT_WINDOW_MS)};
if(!isActive||Date.now()-lastInput>${String(INPUT_WINDOW_MS)})return false;
parent.postMessage({type:"${PREVIEW_SEND_MESSAGE}",text:text.slice(0,${String(PREVIEW_SEND_MAXIMUM_LENGTH)})},"*");
return true;}
Object.defineProperty(window,"pages",{value:Object.freeze({chat:Object.freeze({send:send})}),writable:false,configurable:false});
})();</script>`;

/** Light page colors for code that sets none, independent of the theme of Pages. */
const BASE_STYLE =
  "<style>:root{color-scheme:light;background:Canvas;color:CanvasText}</style>";
const SVG_STYLE =
  "<style>body{margin:0;min-height:100vh;display:grid;place-items:center}svg{max-width:100%;height:auto}</style>";
const DOCUMENT_HEAD =
  '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';

/** Keeps a closing tag inside code from ending the element that holds it. */
function guardClosingTag(source: string, tag: "script" | "style"): string {
  return source.replace(new RegExp(`</${tag}`, "giu"), `<\\/${tag}`);
}

function stylesOf(files: readonly PreviewFile[]): string {
  return files
    .filter((file) => companionRole(file.languageHint) === "css")
    .map((file) => `<style>${guardClosingTag(file.source, "style")}</style>`)
    .join("");
}

function scriptsOf(files: readonly PreviewFile[]): string {
  return files
    .filter((file) => companionRole(file.languageHint) === "js")
    .map((file) => `<script>${guardClosingTag(file.source, "script")}</script>`)
    .join("");
}

/** Inserts text after the first match of a tag, or returns `null` without one. */
function insertAfter(html: string, tag: RegExp, text: string): string | null {
  const match = tag.exec(html);
  if (!match) return null;
  const end = match.index + match[0].length;
  return `${html.slice(0, end)}${text}${html.slice(end)}`;
}

function insertScripts(html: string, scripts: string): string {
  const close = html.search(/<\/body\s*>/iu);
  if (close === -1) return `${html}${scripts}`;
  return `${html.slice(0, close)}${scripts}${html.slice(close)}`;
}

function htmlDocument(files: readonly PreviewFile[]): string {
  const page = files.find(
    (file) => previewKindOf(file.languageHint) === "html",
  );
  const html = page?.source ?? "";
  const head = `${BASE_STYLE}${BRIDGE_SCRIPT}${stylesOf(files)}`;
  const scripts = scriptsOf(files);
  const complete =
    insertAfter(html, /<head(?:\s[^>]*)?>/iu, head) ??
    insertAfter(html, /<html(?:\s[^>]*)?>/iu, `<head>${head}</head>`);
  if (complete !== null) return insertScripts(complete, scripts);
  return `<!doctype html><html><head>${DOCUMENT_HEAD}${head}</head><body>${html}${scripts}</body></html>`;
}

/**
 * Builds the document of an HTML or SVG preview (PAGE-383).
 *
 * @remarks
 * The HTML file takes the style sheets into its head and the scripts at the
 * end of its body; a fragment is wrapped into a whole document. An SVG
 * stands centered on an empty page. Every document starts with the script
 * of `pages.chat.send`.
 *
 * @param files - The files of the preview; for HTML the page first.
 * @returns The HTML document the sandbox frame shows.
 */
export function buildPreviewDocument(files: readonly PreviewFile[]): string {
  const svg = files.find((file) => previewKindOf(file.languageHint) === "svg");
  if (!svg) return htmlDocument(files);
  return `<!doctype html><html><head>${DOCUMENT_HEAD}${BASE_STYLE}${SVG_STYLE}${BRIDGE_SCRIPT}</head><body>${svg.source}</body></html>`;
}

/** What Pages knows when a preview asks to write into the chat. */
export interface PreviewSendCheck {
  /** The frame of the preview. */
  readonly frame: HTMLIFrameElement;
  /** When this preview wrote last, in ms, or 0. */
  readonly lastSentAt: number;
  readonly now: number;
}

/**
 * Tells whether a preview may write into the chat now (PAGE-383).
 *
 * @remarks
 * The check runs in Pages, so the code of a preview cannot skip it: the
 * frame must hold the focus, because the person clicked or typed in it, the
 * browser must report a fresh user activation, which a click in the frame
 * also gives the page, and the last message of the frame must be at least
 * a second ago. A browser without `navigator.userActivation` lets nothing
 * through.
 *
 * @param check - The frame, the time of its last message and the time now.
 */
export function canSendFromPreview(check: PreviewSendCheck): boolean {
  const { frame, lastSentAt, now } = check;
  if (frame.ownerDocument.activeElement !== frame) return false;
  if (now - lastSentAt < SEND_INTERVAL_MS) return false;
  return navigator.userActivation?.isActive === true;
}

/**
 * Reads the text of a message a preview sent to Pages.
 *
 * @param payload - The data of the message event.
 * @returns The trimmed text, cut to 4,000 characters, or `null` for any
 * other message.
 */
export function readPreviewSend(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  if (!("type" in payload) || payload.type !== PREVIEW_SEND_MESSAGE)
    return null;
  if (!("text" in payload) || typeof payload.text !== "string") return null;
  const text = payload.text.trim().slice(0, PREVIEW_SEND_MAXIMUM_LENGTH);
  return text === "" ? null : text;
}

/**
 * Tells whether a message of a frame says that its document is ready.
 *
 * @param payload - The data of the message event.
 */
export function isPreviewReady(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "type" in payload &&
    payload.type === PREVIEW_READY_MESSAGE
  );
}
