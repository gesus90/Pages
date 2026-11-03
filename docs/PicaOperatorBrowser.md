# Pica operator browser (PAGE-181)

Pica can operate websites visually, like a person with a browser: it opens a
page, looks at a screenshot together with the page's elements and accessibility
tree, plans the next step, acts and checks the result. Administrators watch the
browser live in the Pica chat and can pause, stop or take it over.

This is a **separate operator path** next to the restricted
`admin_browser_open` / `admin_browser_action` tools of
[PicaAdminTools](PicaAdminTools.md), which stay as they are. It is no second
agent architecture: the tools sit in the same `RuntimeToolRegistry`, run through
the same ACP/MCP bridge and the same `PicaAdminService.runPrivileged` scope of
the job (fresh administrator check before and after each call, revocation
aborts the job, audit without parameters).

## Tools (administrator only)

| Tool                | Purpose                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `browser_open`      | Open an isolated browser (`url`, saved `profile`, `device` desktop 1280x800 or mobile 390x844) and return the first view. |
| `browser_observe`   | Screenshot + interactive elements + text (+ accessibility tree with `detail: full`); `annotate`, `fullPage` options.      |
| `browser_navigate`  | `goto`, `back`, `forward`, `reload`.                                                                                      |
| `browser_click`     | Click / double-click / right-click an element `ref` or a screenshot point `x`,`y`; `dialog` answers a confirm it opens.   |
| `browser_hover`     | Hover over a `ref` or point.                                                                                              |
| `browser_type`      | Type into a `ref` or the focused element; `clear`, `submit`.                                                              |
| `browser_press`     | Press keys such as `Enter`, `Tab`, `Control+A`.                                                                           |
| `browser_scroll`    | Scroll the page or an element.                                                                                            |
| `browser_drag`      | Drag and drop with real pointer events.                                                                                   |
| `browser_form`      | Fill several fields (text, select, checkbox/radio) and submit.                                                            |
| `browser_upload`    | Upload a handover-folder file (`~/pica-admin-files`, text documents) or an earlier download into a file field.            |
| `browser_tabs`      | `list`, `open`, `switch`, `close` (at most 8 tabs; popups become tabs).                                                   |
| `browser_viewport`  | Switch desktop/mobile (fresh context, same cookies) or set a custom size.                                                 |
| `browser_wait`      | Wait seconds or until text shows.                                                                                         |
| `browser_handover`  | Ask the administrator to take over (sign in, solve a check).                                                              |
| `browser_downloads` | List/read files the pages downloaded (stay on the server).                                                                |
| `browser_profiles`  | List names and sites of the administrator's saved signed-in sessions.                                                     |
| `browser_close`     | Close the browser.                                                                                                        |

No tool accepts an actor, header, cookie, script or credential. The model names
a place by the **reference** (`e12`) of its last observation or by
**coordinates of the screenshot**. After every action the tool answers with a
new observation, so the model verifies the state. A failed action answers with
a stable error code, a hint and, when possible, the page after the failure
(stale reference, element covered, timeout, blocked address, HTTP 4xx/5xx,
console and page errors, dialogs, new tabs, downloads).

## Screenshots reach the model as image data

Every observation carries the screenshot as a JPEG. `PicaToolOutcome` has an
optional `images` list; `PicaBridgeProtocol` turns it into MCP `image` content
blocks (`{type:"image", data:<base64>, mimeType:"image/jpeg"}`) beside the text
block, so a vision-capable agent sees the picture. Images are never logged,
journaled or stored. The text part keeps the structured facts (url, title,
viewport, scroll position, element references with role, name, box in
screenshot pixels, value and state, visible text, notices). A model without
vision still gets all of this as text.

## Live browser in the chat

`ChatBrowserPanel` (inside `chat-panel.tsx`) follows the administrator's
browsers while the panel is open: state, address, a live picture refreshed
about once a second, the list of actions (Pica and administrator), controls and
an enlarge dialog. The interface is `POST /chat-browser-api` (overview and
commands), `GET /chat/browser/:id/frame` and
`GET /chat/browser/:id/downloads/:downloadId`; each resolves the administrator
right afresh and only serves the caller's own browsers. A person who is no
administrator is refused once and does not poll.

Controls: **Pause / Resume** (a running call finishes, later calls wait up to 20
s and then report `PAUSED_BY_ADMIN`), **Stop** (aborts the running action,
closes the browser; later calls and `browser_open` of the same job answer
`STOPPED_BY_ADMIN`), **Take over / Hand back**.

### Takeover and interactive sign-in

While the administrator has the controls, Pica's calls wait and answer
`ADMIN_HAS_CONTROL`. Clicks, scrolling and typing over the picture are relayed
to the page by `POST /chat-browser-api`; typed text is **never** logged,
audited, answered or sent to the model (the action log only says "Typed N
characters"). Pica can ask for this with `browser_handover`; the chat shows the
reason.

Credentials never reach the model:

- the model cannot type into password, one-time-code or card fields, into fields whose name/label looks like a secret, or text that looks like a credential (`CREDENTIAL_DENIED`); it cannot spell a secret key by key either;
- password fields and every field an administrator typed into are masked in the screenshots the model gets, and their values are hidden in observations (until the next full page load);
- the administrator's own live picture is unmasked and goes only to them;
- there is no tool that reads cookies, storage or script results.

### Saved sessions

After signing in, **Save session** stores the browser's cookies and local
storage under a name, **encrypted at rest** (AES-256-GCM, key derived from the
instance key, bound to person and name) in `pica-browser-sessions/<user>/`
next to the database. Only the same administrator can use them
(`browser_open` with `profile`), always in a new isolated browser; the model
only sees names and sites (`browser_profiles`). Sessions can be deleted in the
chat.

## Isolation and server-controlled access

- Every browser is its own Chromium in the mandatory unprivileged PID/mount/user/network namespace of `PicaBrowserSandbox` (`bwrap`, no host home, no fallback). Profile and cookies are ephemeral and per browser. A browser belongs to one administrator and one job (`adminScope`); another job, another administrator or another browser never reaches it. At most 4 browsers (2 per person) run; they close with the job, after 15 idle minutes, after 2 hours, on stop, on loss of the administrator right and at shutdown.
- The browser has **no network**. All its requests (documents, scripts, forms, fetch/XHR, redirects) are answered by Pages: `PicaBrowserProxy` checks every request against `PicaBrowserTargets`, adds only the cookies of that browser, sends it to the pinned address and returns the answer. Redirects are returned to the browser and therefore checked again.
- Reachable targets: public HTTPS on port 443 with public IPv4 DNS answers (private, loopback, link-local, reserved and Pages host addresses denied, no IP literals, no URL credentials), **this Pages instance** (`http://127.0.0.1:<port>`, `http://localhost:<port>`, `mcpHttp.publicUrl`), and **released local services** from `picaBrowserLocalOrigins` in `config.toml` (exact origins, e.g. `["http://127.0.0.1:8080"]`). The address a request arrived under never widens the list.
- Controlled test of the own Pages UI: Pica's control surfaces (`/chat-api`, `/chat/`, `/api/v1/pica-bridge`, `/pica-tools-api`, `/mcp`, `/oauth/`) are unreachable from the browser. Requests that change something (not GET/HEAD/OPTIONS) to Pages or a released local service are refused (`LOCAL_WRITE_NOT_APPROVED`) until the administrator ticks "Allow Pica to make changes" for that browser; requests during a takeover are the administrator's own. Sign in with a suitable account yourself via takeover (and save the session if wanted).
- Not offered: WebSockets (closed), service workers (blocked), permissions (none), arbitrary JavaScript, reading cookies or storage, access to the host file system. Downloads (attachments and non-renderable documents) are captured on the server (max 25 MB each, 100 MB per browser, 20 files) and offered to the administrator; blob/data-URL downloads are not captured. Uploads read only the handover folder rules of [PicaAdminTools](PicaAdminTools.md).
- Network use per browser is bounded: 4000 requests, 400 MB, 25 MB per response, 25 s per request.
- Page, element and file contents are untrusted data and carry that note in every result.

## Host prerequisites

Same as the restricted browser: Linux, unprivileged `bwrap` and the Chromium
revision of the pinned `playwright-core`. The operator path adds no host
dependency.

## Audit

Tool calls use the existing `pica.admin.tool` audit (tool name, hash of the
arguments, status). Controls of the administrator (pause, takeover, input,
stop, save session, approval) are audited as `pica.browser.control` with the
command name only.
