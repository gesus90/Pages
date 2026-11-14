import {
  PREVIEW_READY_MESSAGE,
  PREVIEW_RENDER_MESSAGE,
  PREVIEW_SANDBOX,
} from "@/app/components/chat-page/content/preview-document";

/**
 * The policy of the frame document: everything may be loaded from the
 * network, scripts and styles included (PAGE-383), only Pages may frame it,
 * and the browser sandboxes it even when it is opened on its own.
 */
export const PREVIEW_FRAME_POLICY = [
  "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
  "frame-ancestors 'self'",
  `sandbox ${PREVIEW_SANDBOX}`,
].join("; ");

/**
 * The frame document: it waits for the document of the preview from the
 * page that framed it and replaces itself with it. It answers only its
 * parent, which only Pages can be.
 */
const FRAME_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>Preview</title>
</head>
<body>
<script>
(function () {
  var isRendered = false;
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (isRendered || event.source !== parent || !data) return;
    if (data.type !== "${PREVIEW_RENDER_MESSAGE}" || typeof data.html !== "string") return;
    isRendered = true;
    document.open();
    document.write(data.html);
    document.close();
  });
  parent.postMessage({ type: "${PREVIEW_READY_MESSAGE}" }, "*");
})();
</script>
</body>
</html>`;

/**
 * The empty document every HTML and SVG preview of the chat runs in
 * (PAGE-383): `GET /chat/preview-frame`.
 *
 * @remarks
 * The chat frames it sandboxed without the own origin, so the preview gets
 * an opaque origin: it reaches neither cookies nor storage nor the windows
 * and interfaces of Pages, cannot navigate the page and opens no window.
 * Its own policy lets it load content and libraries from the network
 * without a list of allowed sources. The document holds nothing of the
 * person, so it needs no sign-in.
 */
export function loader(): Response {
  return new Response(FRAME_DOCUMENT, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": PREVIEW_FRAME_POLICY,
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
