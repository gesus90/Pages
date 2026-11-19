# Content cards in conversations

Messages of the chat page show their content as cards: code with syntax
colors, diffs, rendered Markdown, images, PDFs, video, audio, embedded web
pages, link cards and other files. A card is collapsed, expanded or opened
next to the chat (split view).

## Where things are

| Part                                                                         | Place                                                                             |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Tables (attachments, embed domains, link previews, card states, split width) | `backend/database/postgres/migrations/048_conversation_content.sql`               |
| Contracts and limits                                                         | `definition/ConversationContent.ts`                                               |
| Attachments: upload, rights, ranges, deletion, sweep                         | `backend/service/conversation/content/ConversationAttachments.ts`                 |
| File lines of agents `![…](file:/absolute/path)`                             | `backend/service/conversation/content/ConversationAgentFiles.ts`                  |
| 3D models and Godot web export packages                                      | `ConversationModelFiles.ts`, `ConversationWebPackages.ts` in the same folder      |
| Links, embed rules, preview cache                                            | `backend/service/conversation/content/ConversationLinks.ts`                       |
| Fetch of link previews (replaceable)                                         | `backend/service/conversation/links/`                                             |
| Cards, split view, viewer                                                    | `app/components/chat-page/content/`                                               |
| Composer menu, uploads, drop and paste                                       | `app/components/chat-page/chat-page-attach-menu.tsx`, `use-attachment-uploads.ts` |
| Theme tokens `--color-code-*`, `--color-diff-*`                              | `app/styles/tailwind.css`                                                         |

## Addresses

- `POST /chat-page-api/files?conversationId=…&name=…` (or
  `kind=group|participant&id=…`), body = file, `Content-Type` = its type:
  stores an attachment (at most 512 MB) and answers `{ ok, attachment }`.
  `PUT /chat-page-api/files?attachmentId=…` stores the preview image (WebP,
  JPEG or PNG, at most 1 MB) of an attachment that has none, `DELETE` drops
  an unsent upload. A message is sent with `attachmentIds` (at most ten).
- `POST|DELETE /chat-page-api/files?agentId=…&name=…` does the same for the
  direct chat with an agent: the file goes into the agent's chat session as a
  session attachment (the types and the 16 MB of every chat session, at most
  ten unsent files), and the message to the agent (`send`) names its ID.
  `GET /chat/agent-files/<agentId>/<id>` sends it to the person of that chat
  only, and `GET /chat/agent-files/<agentId>/messages/<messageId>/files.zip`
  sends the files of one message as a ZIP. A voice message to an agent
  (`POST /chat-page-api/voice?agentId=…`) is recognized before sending and
  goes as its text; the audio is not kept.
- `GET /chat/files/<id>` streams the original (`Range` answers 206,
  `?download=1` sends it as a download), `GET /chat/files/<id>/thumbnail` the
  preview image. Membership of the conversation is checked on every request;
  a non-member gets 404.
- `GET /chat/embed?url=…&conversationId=…` answers the frame document of an
  embeddable page, else 403. The page of Pages only ever frames this own
  document; the document frames the foreign page sandboxed
  (`allow-scripts allow-forms`), credential-less and without referrer, and
  its policy allows that one origin only.
- `GET /chat/link-image?url=…` sends the stored preview image of a link.
- `GET|POST /settings-api/embed-domains`: the domains an administrator
  released for every conversation.

## 3D models and playable scenes

An agent's answer shows a Blender model or a Godot scene interactively in the
message, in direct and in group chats. The PNG stays the start image and the
fallback.

- **Model:** a file line naming a self-contained glTF 2.0 binary file
  (`.glb`, textures embedded, at most 64 MB). Pages checks the container, the
  single buffer, the buffer views and the embedded PNG, JPEG or WebP images
  and refuses every `uri` (other files, addresses and data addresses) and
  every required extension the viewer cannot draw
  (`ConversationModelFiles.ts`). A refused model keeps its line with the
  reason. A PNG of the same name next to it (`model.png` for `model.glb`, at
  most 1 MB) becomes its preview image. The type `model/gltf-binary` is
  stored only for a checked file; an upload of a person is checked the same
  way and stays a plain download otherwise. The card (`model-card.tsx`)
  shows the start image with "3D-Ansicht starten"; the viewer of Pages loads
  the file from `GET /chat/files/<id>` and draws it with WebGL 2: drag or
  arrow keys turn, wheel, two fingers or `+`/`-` zoom, "Ansicht
  zurücksetzen" resets, "Vollbild" fills the screen. Without WebGL 2 or when
  the file cannot be read the start image stays with the reason.
- **Godot web export:** a file line naming the manifest
  `pages-web-export.json` of a Godot 4.3+ web export with the Compatibility
  renderer and without threads (`definition/ConversationInteractiveContent.ts`).
  It lists `<executable>.js`, `.wasm`, `.pck`, optionally the two audio
  worklets and a PNG start image, each with size and SHA-256, at most eight
  files, 128 MB each, 192 MB together; the HTML page of the export is never
  part of it. Regular attachments never take WebAssembly, so the package has
  its own path (`ConversationWebPackages.ts`): every file is checked in the
  export directory, copied into the file store with its checksum checked
  again, and recorded together with the manifest attachment
  (`conversation_web_package_files`, migration 079); only then the answer
  binds it. An interrupted copy leaves nothing; a repeated answer binds the
  package once.
- `POST /chat-page-api/web-packages` with `{ attachmentId }` starts the player
  for a member of the chat and answers `{ ok, session: { url, expiresAt,
isOwnOrigin } }`; `DELETE /chat-page-api/web-packages?token=…` stops it. A
  start is a secret of 30 minutes for one member and one package
  (`conversation_web_package_grants`, only its SHA-256 is stored).
- `GET /chat-player/<secret>/index.html` is the entry page Pages writes
  itself, `pages-player.js` its start script, and the listed files follow
  below the same address. No sign-in is read: every request checks that the
  start is neither stopped nor expired, that its member still belongs to the
  chat and that the package has not expired; otherwise it answers 404. The
  policy loads only from the package and lets only Pages frame it.
- `chatPlayerOrigin` in `config.toml` (for example
  `"https://play.pages.example"`, another host that reaches this instance)
  together with `publicUrl` runs the players on that origin, which never
  receives the session cookie of Pages; only that host answers
  `/chat-player/…` then. The policy of the chat page frames only Pages, so
  the start answers `/chat/player-frame/<secret>` instead: a document of
  Pages without script for the account that started the player, whose
  policy frames only the player origin and which holds the player in one
  frame of that origin. Without it the chat frames the player on the origin
  of Pages sandboxed without `allow-same-origin`, so the browser gives it an
  opaque origin. Either way the frame has no message bridge to the chat, and
  the scene runs in the browser of each member.
- Agents run their chat answers on the Pages host. Remote execution targets
  exist for plan runs only, so no chat transport yet carries an export from
  a remote runner to a chat answer; such a transport would hand its files
  to the same checked package path.

## Pica Mobile (`conversations.v1`)

Every `ConversationMessage` carries `attachments` (`id`, `name`, `mimeType`,
`sizeBytes`, `kind`, `url`, optional `thumbnailUrl`) and `links` (`url`,
`domain`, `title`, `description`, `imageUrl`, `embeddable`).
`conversation_send` takes optional `attachmentIds`. On the port of the app the
addresses of the web answer below `/pica-mobile` with the session token as
`Authorization: Bearer`: `GET /pica-mobile/chat/files/<id>[/thumbnail]` and
`POST|PUT|DELETE /pica-mobile/chat-page-api/files`. `url` and `thumbnailUrl`
are the web paths; the app prefixes `/pica-mobile`.

## Decisions

- Attachments and agent file lines belong to stored conversations (groups
  and direct conversations). The direct chat with an agent on the web page is
  its chat session: there, code blocks, diffs and URLs become cards, and the
  person can attach files and record voice messages as in every other chat.
  The files are session attachments the agent reads in its prompt (images,
  PDF, Office and text files; other types are refused at the upload), a voice
  message arrives as recognized text. Files of the agent to the person are
  still not possible in this chat.
- Agent file lines follow an allowlist (2026-11-12): only regular
  files below `~/.pages/pica-sessions/<session>/` and `~/Results/`
  (`AGENT_FILE_ROOTS` in `ConversationAgentFiles.ts`), checked after
  `realpath`, with no part below the root starting with a dot; the old
  credential places and secret file names stay refused on top. Anything else
  keeps its line with "(Datei nicht angehängt: Ort nicht freigegeben)".
- The files of an answer are stored without a message first and bound after
  the answer is inserted. A file that fails to store keeps its line
  with "(Datei nicht angehängt: Speichern fehlgeschlagen)"; leftovers of a
  repeated answer are released at once, others are swept after a day.
- An own message can be deleted (bin below the message); its attachments
  and preview images are removed with it.
- Collapsed or expanded is remembered per person and card on the server;
  the split view itself is not reopened after a reload. Its width is
  remembered per person.
- The preview image of a link is fetched and stored by the server, so no
  browser contacts the linked site for a link card.
- While the agent simulation is on, link previews come from a simulated
  fetch and the simulated agent sends back content lines of the answered
  message, so cards and file lines can be reproduced without a provider.

## Not verified here

The attachment endpoints on the port of Pica Mobile were type-checked but
not called by an app. Real model answers with file lines, real link previews
over the internet, and the designs other than Standard in a browser need the
operator check after deployment; the syntax and diff tokens were checked for
contrast by calculation for every shipped design and both modes.
