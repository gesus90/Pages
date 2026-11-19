# Code recognition and previews in the chat

Code that an agent or a person sends into the chat is shown by its kind:
plain code as a collapsible code card, Markdown rendered, Mermaid as a
diagram, JSON as a tree, CSV and TSV as a table, and HTML (with its CSS and
JavaScript) and SVG as an interactive preview in a sandbox.

## Where things are

| Part                                                        | Place                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Recognition of a fence without language                     | `app/components/chat-page/content/code-detection.ts`                                         |
| Split of a message, joining HTML with its CSS and JS blocks | `app/components/chat-page/content/message-content.ts`                                        |
| Kinds of preview, file names                                | `app/components/chat-page/content/preview-kinds.ts`                                          |
| Preview document, `pages.chat.send`, the check of a send    | `app/components/chat-page/content/preview-document.ts`                                       |
| Frame document with its own policy                          | `app/routes/chat-preview-frame.ts` (`GET /chat/preview-frame`)                               |
| Cards, split view and full screen of a preview              | `preview-card.tsx`, `preview-panel.tsx`, `preview-views.tsx`                                 |
| Sandbox frame, Mermaid, JSON tree, CSV table, ZIP download  | `sandbox-frame.tsx`, `mermaid-*.ts(x)`, `json-*.ts(x)`, `csv-*.ts(x)`, `preview-download.ts` |
| Marker "aus der Vorschau gesendet"                          | `CONVERSATION_PREVIEW_SEND_PREFIX` in `definition/Conversation.ts`                           |

## Recognition

A fence that names a language keeps it. A fence without one gets the
language its content shows clearly: JSON, SVG, HTML, Mermaid, Diff, SQL,
Shell, Python, TypeScript, JavaScript, CSS, YAML, Markdown, CSV or TSV. The
card says "automatisch erkannt: …". Content that fits no language clearly
stays plain text.

## Sandbox

HTML and SVG previews run in an `<iframe src="/chat/preview-frame"
sandbox="allow-scripts allow-forms allow-modals">`. Without
`allow-same-origin` the frame has an opaque origin of its own: it reaches no
cookie, no storage, no session, no window and no interface of Pages, cannot
navigate the page (`allow-top-navigation` is missing) and opens no window
(`allow-popups` is missing). The frame document carries its own policy
(`default-src * data: blob: 'unsafe-inline' 'unsafe-eval'`,
`frame-ancestors 'self'`, plus the same sandbox as header), so a preview may
load content and libraries from the network while the page of Pages keeps
its strict policy. Pages hands the frame its document with `postMessage`
once the frame reports that it is ready. A collapsed card renders no frame,
so nothing runs.

Mermaid, JSON and CSV are drawn by Pages itself; nothing of their text is
executed. Mermaid runs with `securityLevel: "strict"`.

## Writing back into the chat

A preview may call

```js
pages.chat.send("Variante B nehmen"); // returns true when handed to Pages
```

It works only right after a click or an input of the person in the
preview. The frame checks its last trusted input, and Pages checks again in
the page itself: the frame must hold the focus, the browser must report a
fresh user activation (`navigator.userActivation.isActive`) and the last
message of this frame must be at least one second old. The text is cut to
4,000 characters. The message is sent like a typed one, but with a
`clientMessageId` that starts with `preview-`: it is an ordinary message of
the person (reply rules and `@` mentions apply), never runs as a chat
command, and every member sees it marked "aus der Vorschau gesendet". The
preview has no other function of Pages.

## Split view and full screen

"Daneben" opens the preview as a column right of the chat with the head of
the cards, "Vorschau | Code", "Desktop | Tablet | Mobil", "Neu laden" (HTML),
"Vollbild" and "Schließen"; its width is dragged at the divider and
remembered per person ([content cards](ConversationContentCards.md)). On a narrow screen it opens as full screen.
The full screen shows "Vorschau | Code | Beides", the device widths,
"Neu laden", "Kopieren", "Herunterladen" (one file, or `preview.zip`),
"Zur Nachricht" and "Schließen"; Escape closes it, R loads it again and C
shows or hides the code.
