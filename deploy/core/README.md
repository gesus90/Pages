# pages-core

`pages-core` (PAGE-237) is a small Rust service that holds the live streams
(`/live-changes`, SSE) of the pages and delivers the committed events of
`pages_event_outbox`. It knows no business rule and reads no business table:
whether an account may learn about an event is asked from `pages-api` over the
versioned contract of `definition/PagesCoreContract.ts`, with a time limit of
3 seconds. A timeout, an error or another contract version delivers nothing.

Build and checks: [core/README.md](../../core/README.md).

## Service status (PAGE-238)

With `--status-target pages.target` (the template's default through
`PAGES_CORE_STATUS_OPTIONS`) the core reads the services of that target from
the systemd manager over D-Bus: the services the target wants or requires and
those that are `PartOf=` it. Of each it requests only the name, active state,
start time of the main process and restart count, plus load state, type and
result for the light, at most once every two seconds and within two seconds.
No other unit is listed and no other property is read, so paths, command
lines, environment and credentials of a unit never reach the core.

- `GET /service-status` answers everyone with one light: `green` when every
  service runs (a one-shot service also after a successful run), `yellow`
  while one starts, stops or restarts, `red` when one stopped, failed or is
  missing, `unknown` when the manager cannot be read. It needs neither the API
  nor a session, so it stays visible while `pages-api` is down.
- `GET /service-status/details` adds name, state, last start and restarts of
  every service, only for a session the API confirms as an active admin mode
  over `POST /api/core/v1/status-access` (contract v1, 3 s limit). The core
  asks for every request and keeps no answer. Without a session, or for any
  other account, it answers `403`; without a valid answer in time, `503`. Both
  carry only the light.

The format is `definition/ServiceStatus.ts`. Reading the system manager's unit
properties needs no privilege; the unit's sandbox keeps the D-Bus socket
reachable.

## WebSocket relay (PAGE-239)

The core can hold the WebSocket connections of Pica Mobile, of the runners
and of the consoles, so that they no longer end at the API process. It relays
them; it reads no frame and decides nothing:

- **Handshake.** A client's upgrade is answered only after the API accepted
  the same upgrade. The core repeats the path, `Host`, `Origin`, `Cookie`,
  `User-Agent` and `Sec-WebSocket-Protocol` (a runner's credential) and, from
  the entrance, `X-Forwarded-For` and `X-Forwarded-Proto`. A refusal of the
  API reaches the client with its status (`401`, `403`, `404`, `503`); while
  the API cannot be reached in 10 seconds the client gets `502`. No
  connection is open that the API has not admitted, also after an API crash.
- **Frames.** Text and binary messages pass unchanged and in order, one at a
  time: the core reads the next message of a side only after it wrote the
  previous one to the other side, and a write that takes longer than 30 s
  ends the connection. Memory stays bounded by two messages per connection
  (Pica Mobile 128 KiB from the app, a runner 2 MiB, a console 64 KiB; the
  API's limits). Close frames pass unchanged in both directions, so the
  API's 1008 "Session ended", a console's 4001/4003 and every other code
  reach the client as before.
- **Heartbeat.** The core answers the API's pings. It pings Pica Mobile
  every 20 s and drops an app silent for 45 s, and a console every 15 s,
  dropped after 30 s, as the API did. A runner's heartbeat messages pass
  through and the API keeps judging them.
- **API restart.** No session survives in a new API process by itself: the
  Pica Mobile login and a runner's reconciliation belong to the API
  connection, a console's shell to the API process. When the API's side ends
  without a close frame, the core closes the client with the code after
  which its protocol reconnects by itself: Pica Mobile `1001` (as for a Pages
  restart), a runner and a console `1012`. A graceful API stop sends its own
  `1001` to Pica Mobile. The app signs in again with its session, the runner
  reconciles from its journal. Nothing is replayed, since an input could run
  twice; a message read but not delivered is counted as `undeliveredToApi` or
  `undeliveredToClient` in the log line `core.relay.closed`. While the API is
  down, a reconnect gets `502` and the client keeps trying with its backoff.
- **Console after an API restart.** The API stores the identity of every
  workspace and connection console in `remote_console_sessions` (migration
  016): owner, target, geometry, attempt and last event number, never output,
  input or a credential, for the console's lease (90 s after the last
  activity). The unchanged browser client reattaches to the same console id
  every 3 s. The API restores it only for the same signed-in owner and
  target, after checking the owner's rights anew, within the lease and the
  attempt budget; otherwise the console is unknown (`404`) as before. The
  restored console starts a fresh shell with the next attempt number and
  begins with a `gap` event, so the browser reports the lost output; the old
  shell's output, input and effects do not return. Closing the panel, `exit`
  in the shell or revoked rights forget the identity. A guided runner setup
  is never stored: its command never runs twice.
- **Attachments over HTTP** (Pica Mobile port). Request and answer stream
  unbuffered. Once the request is sent, the API has 10 s for its answer,
  otherwise the app gets `504`; an unreachable API gives `502`. A body that
  stands still for 30 s or lives longer than 15 minutes ends the exchange,
  and an app that goes away closes the connection to the API.
- **Limits.** 100 Pica Mobile, 200 runner and 100 console connections, as
  in the API; more get `503`. At the core's stop every client gets `1001`.

Log lines name the channel, a connection number, counts and close codes;
never a header, a credential or a message.

### Switching the channels over

Each channel has its own switch; the others keep their way.

1. **Pica Mobile** first: set `picaMobileRelayPort = <free loopback port>`
   in `config.toml` (it needs `pagesCoreSecret`) and restart the API. The API
   then listens on `127.0.0.1:<picaMobileRelayPort>` and admits only requests
   with `X-Pages-Core-Authorization: Bearer <pagesCoreSecret>`, contract
   version 1 (`X-Pages-Core-Contract`) and the app's address
   (`X-Pages-Core-Client`) for its login limit. The core notices the key
   within a second and listens on `picaMobilePort` (on `listenAddress`, or
   on every interface), retrying every five seconds while the API still
   holds it. The app's address, path, login and attachment endpoints stay
   the same. A port change in the settings binds through the core: the API
   checks the port is free, stores it, waits up to five seconds until the
   core serves it and otherwise stores the previous setting again, also no
   port at all. Port changes run one after another. Back: remove
   the key; the core closes the port within a second (`core.mobile.stopped`).
   Restart the API only then: an API that starts while the core still holds
   the port cannot bind it and reports the endpoint as not listening until
   the port is saved again, as for any taken port.
2. **Runners**: `PAGES_INGRESS_RUNNER_OPTION=--core-runner http://127.0.0.1:3200`
   in `ingress.env`, restart `pages-ingress@<instance>`. Back: remove it.
3. **Consoles**: `PAGES_INGRESS_CONSOLE_OPTION=--core-console http://127.0.0.1:3200`,
   restart the entrance. Back: remove it.

Neither the Pica Mobile app nor an installed runner needs an update.

## What it reads and writes

- `pages_event_outbox` and `pages_event_outbox_floor`: read only, in commit
  order, after its tail and, for a stream that fell behind its memory cache,
  after that stream's cursor (at most 256 events per read).
- `pages_event_outbox_readers`, row `pages-core`: the lowest cursor a browser
  may come back with, at most once per second and at the stop. Counted are the
  cursors the open streams hold, those of streams closed in the last two
  minutes (longer than the browser's longest reconnect wait) and, for two
  minutes after a start, the previous value. Retention keeps every event after
  it, so a stream waiting for a decision or reconnecting never loses its
  backlog.
- `config.toml` of the instance: `databaseUrl` and `pagesCoreSecret` at the
  start; `picaMobileRelayPort`, `picaMobilePort` and `listenAddress` once a
  second while it runs.

## Delivery and gaps

A notice is the same `change` event as on the API's own stream. Its SSE `id`
is an opaque cursor: the stream's outbox position sealed with
ChaCha20-Poly1305 under a key derived from `pagesCoreSecret`, bound to the
browser's session and with a fresh nonce each time. A browser learns neither a
position nor how many events lie between two notices. It sends the cursor back
as `Last-Event-ID` (or `?after=`), and the core continues right after it, also
after its own hard restart. A cursor of another session, an altered one or one
beyond the outbox's head gets a `resync` once `pages-api` has confirmed the
session.

A cursor's position only moves when `pages-api` decided the events after it
for that session, or when a complete read proves there are none. A timeout or
a failed answer leaves it where it is. The newest 8,192 events are kept in
memory; older ranges are read from the outbox, so a returning stream gets every
event the outbox still holds. Only a cursor below the retention floor gets an
explicit `resync`; there is no silent gap.

A stream gets frames only for events its account may see, and none for events
it may not see. Every 25 s, on a fixed timer and whatever happened, each
stream gets a keep-alive with a fresh cursor of its decided position, so a
stream that sees nothing for a long time does not come back with an old one.

## Switching a running instance over

The switch of a live server is done together with the owner and is not part of
the repository change.

1. Write a random secret of at least 32 visible ASCII characters as
   `pagesCoreSecret` into `/etc/pages/<instance>/config.toml`, for instance
   `openssl rand -hex 32`, and restart `pages-api@<instance>`. Without it the
   decision endpoint answers 404.
2. Build the core and `systemctl enable --now pages-core@<instance>`.
3. Set `PAGES_INGRESS_CORE_OPTION=--core http://127.0.0.1:3200` in
   `/etc/pages/<instance>/ingress.env` and restart `pages-ingress@<instance>`.
4. For the service status, set
   `PAGES_INGRESS_STATUS_OPTION=--service-status http://127.0.0.1:3200` there as
   well. It is a switch of its own: the status works with either live stream,
   and removing it makes `/service-status` answer 404 again.

Back to the old way: remove `PAGES_INGRESS_CORE_OPTION` and restart the
entrance; the API's own `/live-changes` serves again. The core may keep running
or be stopped. While the core is stopped, the stream answers 502 and the pages
read again every minute; the app, the API and the runs keep working.
