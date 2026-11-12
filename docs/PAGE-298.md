# PAGE-298: Content cards in conversations

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
  a text-only chat session: there, code blocks, diffs and URLs become cards,
  but files cannot be attached in either direction.
- Agent file lines follow an allowlist (fix B1, 2026-11-12): only regular
  files below `~/.pages/pica-sessions/<session>/` and `~/Results/`
  (`AGENT_FILE_ROOTS` in `ConversationAgentFiles.ts`), checked after
  `realpath`, with no part below the root starting with a dot; the old
  credential places and secret file names stay refused on top. Anything else
  keeps its line with "(Datei nicht angehängt: Ort nicht freigegeben)".
- The files of an answer are stored without a message first and bound after
  the answer is inserted (fix B2). A file that fails to store keeps its line
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
