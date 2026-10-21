# Pica administrator browser and files (PAGE-139)

Pica's native API catalog and ACP tool bridge offer `admin_browser_open`,
`admin_browser_action`, `admin_files_find`, `admin_files_read` and
`admin_files_edit`. Every invocation checks the current active account and
administrator role in admin mode. The tools share the existing turn budget.
Their results are untrusted observations, and do not change Pica's protected
instructions, ordinary permissions, attachment handling or plan execution.

Administrators can also use **Pica admin tools** from Settings or `/pica-tools`.
That task surface invokes the same native registry. Browser sessions belong to
one person, conversation and job. Complete tasks explicitly; they expire after
ten minutes and close automatically on cancellation, job completion, loss of
administrator eligibility or server shutdown. Active tasks recheck eligibility
every 250 ms; each action and browser request also rechecks it immediately.

## Host prerequisites and isolation

Linux, working unprivileged bubblewrap (`/usr/bin/bwrap`), and the Chromium
revision for the pinned `playwright-core` version are required. An operator can
provision it with `node_modules/.bin/playwright-core install chromium` outside
Pica; no runtime installation is attempted. The standard Playwright browser
cache or its operator-defined `PLAYWRIGHT_BROWSERS_PATH` is used. Failures refuse
the operation, with no unisolated fallback. The service refuses root execution.

Every browser has an ephemeral profile inside mandatory PID, mount, user and
network namespaces. Capabilities are dropped; only browser/system libraries
are mounted read-only. Host homes, Pages data, sockets and host networking are
absent. Chromium's inner sandbox is disabled **inside** this mandatory outer
sandbox so it does not require nested user namespaces. No host permission or
capability is changed.

Public browsing is restricted to one HTTPS origin per browser task, port 443,
and GET requests. Each resource is fetched by the server with public IPv4 DNS
validation, a pinned destination and TLS hostname verification. Private,
loopback, link-local, reserved and host interface addresses are denied, as are
observed Pages hosts. No redirects, imported cookies, request authorization,
password entry, downloads, uploads, form submissions, WebSockets, service
workers or arbitrary script tool exist. Scripts cannot contact the host: the
browser namespace has no external network. Cross-origin resources are denied;
websites that need them or authenticated state may not work. The task's initial
address and each observation are visible. Closing uses only the browser process
owned by that task, never global process signals.

A local HTML document from the permitted handover folder can be viewed without
connecting to a local server. It is fulfilled at an internal synthetic URL with
scripts and external resources disabled. A local service or Pages URL is never
an allowed test target.

## Handover files and conflicts

The only allowed root is the code-defined `~/pica-admin-files/<Pages user ID>/`
under the Pages process's home. The operator creates it and deliberately places
non-secret documents there; Pica cannot create directories or widen its roots.
All path components are opened without symlink following and anchored to live
Linux file descriptors. The handover directories and files must belong to the
server account and must not be group/world writable. Files must be regular,
single-linked UTF-8 documents, at most 64,000 bytes, with `.txt`, `.md`, `.csv`,
`.json` or `.html` extensions. Native results retain the existing 20,000-character
limit; an oversized read is refused rather than truncated for editing. Hidden paths, traversal, secret/configuration
names and recognizable credentials are refused. Do not place secrets in the
handover area even under innocuous names; arbitrary secret content cannot be
identified reliably by syntax alone.

Finding files lists a single directory (at most 100 entries), never follows
links and never reads their contents. Reading issues a ten-minute revision
bound to the person, job and relative file. Editing consumes that revision,
reads current bytes again, compares content, inode and nanosecond modification
metadata, and replaces exactly one unique passage. No file creation or deletion
is offered. After a conflict, read again and review the intended change with
the person. Pages edits are serialized, with no asynchronous gap between final
comparison and writing. External programs do not share this serialization;
operators must not write handover files during the short synchronous commit
itself. Optimistic revision checking detects changes before commit, and is not
an OS-wide mandatory lock against an uncooperative concurrent writer.

## Audit

Structured `pica.admin.tool` events record user, conversation, run, tool,
started/completed/refusal status and an opaque SHA-256 correlation digest.
Revocation and closure are recorded separately. Raw task text, addresses,
selectors, file paths, contents and credentials are never audit fields. Only
bounded, credential-filtered observations reach the requester/model. The
administrator role grants no additional operating-system privileges.
