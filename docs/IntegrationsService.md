# Integrations: GitHub, Discord and FCM

[Documentation index](README.md) · [Service operation](#mode-and-operation) ·
[GitHub issue states](#github-issues-done-and-archive) ·
[Discord setup](#discord-notifications) · [Google Drive setup](StorageApi.md#google-drive-sign-in-page-170)

`pages-integrations.mjs` runs the GitHub queue and the FCM push outbox in a separate
Node process. It uses the same built server artifact and PostgreSQL database as
Pages. It starts no web listener, mobile gateway, agent execution engine, runner
recovery, catalog refresh, or tool provisioning. Its authorization objects read
the same current account, project, plan, workspace, model, ticket and attachment
permissions as the API. Constructing those objects starts no external session.

Google Drive setup and file operations are documented in
[Storage](StorageApi.md#google-drive-sign-in-page-170). The provider consoles
linked below require their own sign-in; Discord also requires JavaScript.

Discord extraction is **DEFERRED_BY_USER** (PAGE-225 scope correction,
2026-11-05). Its existing implementation and server behavior are unchanged.
The mode below applies only to GitHub and FCM; it does not disable Discord.

## Mode and operation

The persisted `config.toml` key is:

```toml
integrationsMode = "server"
```

Omitting it keeps the legacy location inside the API server. Only `"server"`
and `"separate"` are accepted. A mode change requires a process restart; this is
not a live toggle. Both processes must use the same instance configuration,
database and instance key. Existing settings writes preserve the key.

To prepare a separate installation, first install the matching application
build and let the API server apply the numbered PostgreSQL migrations. The
integration service does not migrate, finish setup, or create a configuration.
After an explicitly authorized maintenance stop of the old consumer, set:

```toml
integrationsMode = "separate"
```

Restart the API server with that configuration, then start:

```sh
node pages-integrations.mjs --config /absolute/instance/config.toml
```

Starting the entrypoint without explicit separate mode refuses startup. Returning
to server mode uses the reverse maintenance sequence: stop the separate consumer,
change the shared configuration, restart Pages. No deployment or switch is
performed by adding this source package.

`deploy/integrations/pages-integrations@.service` is an unactivated template.
Adjust the Node/install/configuration paths and dedicated service account to the
installation. The data directory must be `/var/lib/pages/%i` or its narrowly
configured replacement. `MemoryMax=256M` is the 256 MiB cgroup budget; the V8 heap
limit leaves headroom for buffers, native libraries and connections. Restart is
always enabled. Do not grant additional writable host directories just to make
an incorrect path work. Configuration and FCM key files must be readable only by
the service identity, and the instance data/key directory must be shared with
Pages under that identity. ProtectHome intentionally excludes home directories.

## Ownership, API behavior and outage

A dedicated PostgreSQL session advisory lock elects exactly one GitHub/FCM
processor per database, across both modes. It is not a time lease: a slow live
consumer is not replaced just because a deadline elapsed. A second separate
process refuses startup and can retry under systemd. A non-owning API process
continues serving requests and producing jobs. In server mode a non-owning
replica needs a restart to compete for ownership after the owner dies.
A lost ownership connection terminates the owning process immediately so it
cannot knowingly continue sending without its lock. Database/network failure
cannot provide a distributed exactly-once guarantee for an external side effect.
The operating mode change therefore requires stopping the former consumer;
merely editing one process's copy of the file is not a supported handover.

The service retains ownership throughout shutdown, including bounded FCM drain,
until process exit. PostgreSQL then releases the lock. GitHub jobs in flight
are recovered by the next elected owner; FCM resumes after its existing
120-second delivery lock expires. Polling picks up newly committed jobs without
any IPC dependency on the API server. FCM callbacks in the API process are gated
by ownership, as are its periodic dispatch and direct `kick` calls. Registration,
replay reads and recording of run events stay in the server (and existing run
producer paths); FCM key availability continues to be checked there for the
existing capability/registration contract. Keep the same protected FCM settings
available to both processes.

Every GitHub operation that contacts GitHub uses the durable job queue in
production, including periodic synchronization, committed ticket publication,
manual synchronization, connection checks, import/link and conflict resolution.
Purely local listing, assignment and dismissal stay local. Request-triggered
operations preserve their existing result shapes and known domain errors.
Results contain only counters, booleans or a task identifier; task responses are
reread with current API access checks. Waiting is bounded to 30 seconds. If the
consumer is unavailable, that request reports pending processing instead of
holding an HTTP connection forever; the stored job is not cancelled or lost.
Other UI/API requests keep working. Do not interpret a timeout as cancellation
or blindly repeat a non-idempotent manual operation.

In separate mode, committed ticket updates return once their publication intent
is stored. Default server mode retains the publication completion wait (bounded
like other queued calls), while the existing best-effort mutation boundary remains. The elected worker serializes these jobs with
manual and periodic work. A later update gets a separate intent, so it cannot be
merged into an already-running job and lost. Scheduled ticks share one active
job and retain the existing per-project schedule/backoff logic. Known access or
validation errors terminate a job; other reconcilable failures get at most six
attempts with persisted exponential delays. Job status and sanitized replies
remain in `integration_github_jobs`; completed/failed replies are retained seven
days. No raw provider body, token, exception message or account snapshot is stored
in that queue. No job-status public API is introduced.

## Recovery and idempotency boundaries

FCM keeps the existing event/device deduplication, encrypted tokens, expiry,
retry policy and notification identifiers. Claims now use `FOR UPDATE SKIP LOCKED`.
A crash after FCM accepts a send but before Pages records completion may repeat a
provider request; the existing notification identity is preserved. This package
does not claim provider-level exactly-once FCM delivery.

GitHub updates reconcile against current remote and local state. For an unlinked
task, `integration_github_creations` journals the create intent before sending.
The issue carries a stable opaque HTML comment. On recovery the worker first
uses a confirmed issue number, or finds the marker in the repository issue list,
and persists the recovered acknowledgement before linking the task. The marker
is retained through later updates and excluded from synchronized content hashes
and imported descriptions. If a previous create was attempted but neither a
confirmed number nor a remote marker can be found, no second create is sent.
The intent stays available for operator reconciliation. Inspect the remote
repository and the creation record before any authorized repair; deleting that
record without establishing the remote outcome can create a duplicate. A crash
between journaling and actually sending is intentionally indistinguishable from
a lost acknowledgement. No hidden timeout waives that uncertainty.

An interrupted external-issue import can have created a local task before storing
its link. Such a running job becomes `uncertain` on ownership recovery, rather
than creating another task. Inspect its command, local task/link and external
issue import record before repair. Other retried manual operations can report an
existing validation outcome after their effect committed; this is not proof of
failure of the original effect. The queue preserves work and evidence, but does
not invent a distributed transaction with GitHub.

The pre-existing producer boundaries remain: ticket publication begins after the
local mutation commits, and mobile events are recorded by the existing observer.
A producer crash in the interval before it stores an intent/event is outside
outbox recovery. Moving consumers does not make that interval atomic. Periodic
GitHub reconciliation can repair eligible task state; it is not an assertion that
every event was recorded. Import-generated in-process notifications are likewise
not a new cross-process event bus; Discord extraction is deferred.

## Verification status

This source package is an **unverified checkpoint** for parent review. No live
service is switched. The four isolated runtime criteria (separate delivery and
server exclusion, hard-kill recovery, UI/API independence, default compatibility)
remain UNVERIFIED until the parent provides and reviews permitted synthetic
execution evidence. Discord runtime proof is deferred by the user. The central
configured/affected QA bundle remains mandatory after PAGE-227.

## GitHub issues: Done and archive

The GitHub synchronization of a project mirrors a linked ticket with the issue
of the repository. Title, description and the link stay as they are; the
completion state is carried over as follows.

GitHub's "complete" means that the **issue is closed** (`state: closed`, as
opposed to `open`). Pages does not read or write the custom **Status** field of a
GitHub Projects (V2) board, so a board column has no effect on a ticket, and a
ticket never moves a card.

| Pages ticket                           | GitHub issue at the next sync |
| -------------------------------------- | ----------------------------- |
| active, status **Done**                | closed                        |
| active, any other status               | open                          |
| archived, whatever its workflow status | closed                        |
| restored, status other than **Done**   | reopened                      |
| restored, status **Done**              | stays closed                  |

- **Archiving** stays its own state in Pages. It does not change the workflow
  status and neither deletes nor unlinks the issue; the issue is only closed.
  Tickets archived together with a parent are covered the same way, each through
  its own link. An archived ticket that is not linked never gets an issue.
- **Closing an issue** moves the _active_ ticket to the project's **Done** status;
  it does not archive the ticket. An archived ticket keeps its status.
- **Reopening an issue** takes a ticket out of **Done**, as before. It never
  restores an archived ticket, and the issue of an archived ticket is closed
  again by the next sync.
- A repeated sync without a change on either side changes nothing and creates no
  second issue.

The changes travel with the existing manual and scheduled sync. Direction,
permissions and conflicts apply unchanged: a ticket that changed on both sides is
flagged for a decision instead of being overwritten, a direction that only pulls
never writes to GitHub, and the actor needs write permission on the project.
With the synchronization switched off (`sync_enabled = false`) nothing is read
from or written to GitHub. There is no "last write wins" rule.

## Discord notifications

A project can send notifications about its tickets and milestones to one
Discord text channel. A bot posts them; it is added to the Discord server through
Discord's official installation flow. Nothing else of Discord is used: no
commands, no replies, no direct messages, no reading of messages and no gateway
connection.

### Set up the Discord application (once per instance)

An administrator registers one Discord application for the whole Pages
instance. Projects never ask for credentials.

1. In the [Discord Developer Portal](https://discord.com/developers/applications)
   create an application (for example "Pages").
2. **Bot:** create the bot and copy its token. No privileged gateway intent is
   needed, leave them off. Switch on **Public Bot** if people other than the
   application owner add the bot to their servers.
3. **OAuth2:** copy the client secret and add the redirect
   `<public address of Pages>/discord/callback`, for example
   `https://pages.example.com/discord/callback`. It has to match exactly.
4. Set these environment variables on the Pages server and restart it (see
   [.env.example](../.env.example)):

| Variable                       | Value                                                         |
| ------------------------------ | ------------------------------------------------------------- |
| `PAGES_DISCORD_APPLICATION_ID` | Application ID (the OAuth2 client ID)                         |
| `PAGES_DISCORD_CLIENT_SECRET`  | OAuth2 client secret                                          |
| `PAGES_DISCORD_BOT_TOKEN`      | Bot token                                                     |
| `PAGES_PUBLIC_URL`             | Optional. Public address of Pages, for example behind a proxy |

Without all three secrets, the Discord panel of a project explains which
variables are missing and offers no way to connect. The values stay in the
server process: they are never sent to a browser, never stored in the database
and never logged. To rotate a secret, reset it in the portal and restart Pages.

`PAGES_PUBLIC_URL` decides the redirect address and the links in messages. Set
it whenever the address the browser or phone uses differs from the one Pages
sees, for example behind a reverse proxy; otherwise the address of the request
that starts the connection is used. A phone can only finish the connection if it
reaches that address.

### Bot permissions

The installation link asks for the scope `bot` and the permissions
`View Channel` (1024) and `Send Messages` (2048), together `3072`, and for
nothing else. A channel can only be chosen when the bot can see it and send
into it. Pages computes this on the server from the roles of the bot and the
overwrites of the channel. Only text and announcement channels are listed.
Channels the bot cannot use stay in the list, disabled, with the missing
permission next to them.

### Connect a project

Under **Projects → project → Interfaces** the Discord card opens the settings
panel. Everyone who can read the project sees it read-only; connecting, the
channel, the events, the test message and disconnecting need the right to write
in the project, the same as for the GitHub interface.

1. **Connect Discord** starts a connection attempt. It lives 15 minutes, can be
   used once and is bound to your Pages user and the project.
2. On a computer the panel shows a **QR code** and a button. Both open the same
   official Discord authorization page; the QR code is only the entrance and
   proves nothing. On a phone use the button.
3. Choose the server in Discord. Discord sends the browser to
   `/discord/callback`. That can be the phone that scanned the code: no Pages
   session is needed there. Pages checks the random `state` (only its hash is
   stored, and it works once), exchanges the code, and asks Discord with the
   bot token whether the bot really is on the server the answer names.
4. The panel on the computer notices the result and lists the channels of that
   server. **Server and channel are confirmed there**; only then is the
   connection saved.
5. Four switches select the events **Ticket created**, **Ticket changed**,
   **Milestone created** and **Milestone changed**, each on its own. A new
   connection starts with all four on.
6. **Send test message** posts into the channel at once and shows why it failed
   if it does.
7. **Disconnect** removes the server, the channel, the event selection and the
   messages not sent yet of this project. The bot stays on the Discord server
   (remove it there if you do not need it any more), and other projects stay
   connected.

### What is sent

A message names the event, the ticket key or milestone name, the title, the
status, the project and the link to Pages. It carries no description and no
person. Titles cannot ping anyone: every message disables all mentions
(`allowed_mentions` with an empty `parse`), and `@`, `<…>`, markdown and links
in titles are neutralized as well. Tickets that belong to a department are not
announced, because the channel is not limited to that department.

Changes made in the interface and by agents (plan steps and chat) are announced after
the Pages change committed. A refused, conflicting or rolled back change
announces nothing.

### Delivery and failures

A committed change writes a message to a stored outbox; a worker delivers it
asynchronously, so Discord never blocks or undoes a Pages change.

- Changes of one ticket or milestone that arrive while its message still waits
  are merged into that message, which keeps its event and shows the newest
  facts. A template that adds labels and checklist items to a new ticket
  therefore sends one message, not one per step.
- A failed delivery is tried again after 30 seconds, 2 minutes, 10 minutes,
  30 minutes and 2 hours, and given up after the sixth failed attempt or after
  a day. The panel shows the counters and, in words, the problem that stands.
- A Discord rate limit moves the message to the time `Retry-After` names. It
  does not count as a failed attempt and holds back the messages behind it.
- A problem a retry cannot fix (rejected credentials, the bot removed from the
  server, a deleted channel) ends the delivery at once.
- Every message carries a nonce derived from its identifier, and Discord does
  not create a second message for a repeated nonce. A retry after a lost answer
  therefore does not post twice.
- Stored messages survive a restart. Like the GitHub synchronization, the
  delivery starts with the first request after Pages started.

### Manual acceptance with a real server

Automated tests replace Discord. To check the real thing, set the three
variables, add the redirect in the portal and then:

1. Open **Projects → project → Interfaces → Discord** and choose **Connect
   Discord**.
2. Scan the QR code with a phone, choose a test server and approve. The phone
   shows "Server authorized".
3. On the computer the panel shows the server and its channels. Choose a channel
   and confirm.
4. Send the test message and check it arrives in the channel.
5. Create and change a ticket and a milestone, also through an agent, and check
   one message per switched-on event, with no ping.
6. Switch an event off, disconnect, and check nothing is posted afterwards while
   the bot is still on the server.
