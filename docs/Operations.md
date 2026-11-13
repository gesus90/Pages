# Configuration and operations

[Documentation index](README.md). For local installation use the
[README quickstart](../README.md#getting-started). Production service templates,
maintenance and readiness are in [Platform services](PlatformServices.md).
The paths and startup behavior here were checked against source in PAGE-332;
no instance was started or reconfigured during that documentation change.

- [First start](#first-start)
- [Configuration](#configuration)
- [Static app and entrance (PAGE-235)](#static-app-and-entrance-page-235)
- [Behind a reverse proxy](#behind-a-reverse-proxy)
- [Local services for Pica's operator browser](#local-services-for-picas-operator-browser)
- [Data and runtime directories](#data-and-runtime-directories)

## First start

On a fresh installation (`firstRun = true`), every page leads to the setup
wizard. Pages prints its one-time links directly to the operator console (stdout),
bypassing the logger:

```text
[pages] Pages is not set up yet. Open the setup wizard with this one-time link:
[pages]   http://localhost:3000/setup?token=<one-time-token>
```

The wizard asks for the company, first administrator, language and PostgreSQL
connection URL. Prepare an empty development database using the
[PostgreSQL prerequisites](PostgresMigration.md#local-development-database).
Setup applies migrations and creates the initial account in a database
transaction; it then persists the completed configuration. A private setup
intent supports recovery if configuration persistence fails after commit; see
[Database executor](DatabaseExecutor.md). No DuckDB file is created.

Open the console link. In development the API prints its own port (normally
5174); open the same `/setup?token=…` path on the app's printed address (normally
`http://localhost:5173`) so the static interface can render the wizard.
A restart issues a new token; completing setup invalidates it. There is no
setup-link handoff file. The console is the only application output for this
capability; protect any operator-managed stdout capture as carefully.

## Configuration

Pages keeps its settings in `~/.pages/config.toml`, which it creates on the
first start. A finished setup looks like this (synthetic values):

```toml
firstRun = false
port = 3000
databasePath = "/home/dev/.pages/data/pages.duckdb"
databaseUrl = "postgresql://pages_dev:REPLACE_ME@127.0.0.1:5432/pages_dev"
logRetentionDays = 30
```

This is an illustration of a completed configuration, not a file to paste before
setup. Use the wizard to create the first administrator. Keep the connection
URL private. `databaseUrl` is required once `firstRun = false`; there is no
runtime fallback. `databasePath` retains its historical filename but only its
parent identifies the application data directory. The PostgreSQL server stores
the database independently. Encoding must be UTF8, provider libc, collation
byte ordered and character types `C.UTF-8`/`C.utf8`.

Do not reset a configured instance to `firstRun = true` as a database migration
or account recovery method: setup requires an empty schema (or its matching
recovery intent). See [PostgreSQL migration and backup](PostgresMigration.md)
for transfer, backup and restore verification. The runtime/executor contract is
in [Database executor](DatabaseExecutor.md).

The optional key `picaMobilePort` (1–65535) opens the WebSocket endpoint of the
Pica Mobile app on that port. Administrators set it under Settings >
Connections > Pica Mobile; without the key Pages opens no extra port. See
[docs/PicaMobileWebSocket.md](PicaMobileWebSocket.md).

Two more optional keys configure the Android push notifications of Pica Mobile
(PAGE-193): `picaMobileFcmServiceAccountFile`, the absolute path of a Google
service-account key file kept outside the repository, and
`picaMobileReplayTtlSeconds` (60–3600, default 900). Without the key file Pages
offers no push and says so to the app. Setup, privacy and limits are in
[docs/PicaMobileNotifications.md](PicaMobileNotifications.md).

The optional table `[speechRecognition]` (PAGE-277) names the speech model that
turns voice messages of the chat into text, until Settings > Agents offers a
choice for it: `model`, `url` of an OpenAI-compatible `/audio/transcriptions`
endpoint, and optionally `apiKeyFile`, the absolute path of a file with the API
key, which Pages reads for every recognition and never logs.
`maximumRecordingSeconds` (1–3600, default 300) is the longest voice message.
Without `model` and `url` a voice message keeps its audio and shows that no text
was recognized. Outside production `PAGES_STT_SIMULATION=1` replaces the model
by a simulation that contacts no provider (`PAGES_STT_SIMULATION_SCENARIO`:
`ok`, `provider_failed`, `slow`); with `NODE_ENV=production` the switch is
ignored and the ignoring logged.

```toml
[speechRecognition]
model = "whisper-1"
url = "https://api.openai.com/v1/audio/transcriptions"
apiKeyFile = "/etc/pages/speech-key"
maximumRecordingSeconds = 300
```

The production server (`pnpm run start`) listens on port 3000 by default.
Start parameters win over the file:

```sh
pnpm start --port 8080                     # stored in the configuration
pnpm start --config /srv/pages/config.toml # another configuration file
```

The development server always reads `~/.pages/config.toml`; start parameters
and the configured port do not apply to it.

## Static app and entrance (PAGE-235)

The interface is a static app without server rendering: `build/client` holds
its `index.html`, the hashed files and the service worker `sw.js`, which keeps
the app available offline. Pages read their data from the API's endpoints and
keep the signed-in account's last answers in the browser, so the app also opens
while the API is stopped. `pnpm start` serves the app and the API from one
process. In production the entrance `pages-ingress.mjs` serves the app as its
own process and passes everything else to the API, so a stopped or restarting
API does not take the interface down. Its template and the switch-over are in
[deploy/ingress/README.md](../deploy/ingress/README.md).

Optional environment variables are documented in [`.env.example`](../.env.example).
Pages does not load a `.env` file by itself: export the variables in the shell
or service environment, or start the production server with
`node --env-file=.env server.mjs`.

## Behind a reverse proxy

A reverse proxy that ends TLS (Caddy, nginx, Traefik) hands requests to Pages
over plain HTTP. The browser still sends `Origin: https://…` with every change
(a form post, the Pica chat), and Pages refuses a change whose `Origin` is not
the address of the request, so signing in or using Pica through the proxy
fails until Pages knows which proxy to believe. List the proxy in `config.toml`
(a manual edit that applies after a restart):

```toml
trustedProxies = ["127.0.0.1", "::1"] # addresses or ranges such as "172.18.0.0/16"
```

- An entry is the address Pages sees the proxy connect from, not the address
  of the people who use Pages. For a proxy in a container that is the address
  of the container or of its network. Host names and the range `/0` are
  refused: an invalid entry makes the server exit with code 1 at the start,
  like any other invalid key of `config.toml`. The static app's entrance
  (`pages-ingress.mjs`) reads the same key from the same file, so both
  decide on the same proxies; it believes loopback peers in addition.
- Only a connection from a listed address may say that the request was HTTPS,
  through `X-Forwarded-Proto: https`. Pages then compares `Origin` with the
  `https://` address; the comparison stays on for everyone. From any other
  address, and for any value but `http` or `https`, the header is ignored, and
  Pages replaces a client's `X-Forwarded-For` and `X-Forwarded-Proto` and drops
  `Forwarded`, `X-Forwarded-Host`, `X-Forwarded-Port` and similar headers.
- The proxy has to set `X-Forwarded-Proto` itself to the protocol the browser
  used, replacing any value the browser sent, and has to pass the `Host` of
  the browser on. Caddy's `reverse_proxy` does both
  by default; nginx needs `proxy_set_header Host $http_host;` (it keeps a
  port such as `:1080`, which `$host` drops) and
  `proxy_set_header X-Forwarded-Proto $scheme;` **when it ends TLS itself**.
  An nginx that only listens on HTTP behind another TLS hop must not send
  `$scheme`, which is `http` there for every request: it keeps the value of
  the TLS entry, and only from that entry's address. Both variants are in
  [deploy/proxy/nginx-pages.conf.example](../deploy/proxy/nginx-pages.conf.example).
- Without `trustedProxies`, no proxy is trusted and nothing changes for an
  installation that is reached directly or without TLS.
- A refused change answers HTTP 403. The Pica chat then says that the web
  address does not match the setup of the server, never that rights are
  missing, and the log holds the event `request.origin.rejected` with the
  correlation ID, the route, the reason and the normalized scheme, host and
  port of both origins (no cookie, token, header dump or chat text).
  [deploy/proxy/README.md](../deploy/proxy/README.md) lists the reasons and the
  fix for each, and the Pica approval check of a public address is in
  [docs/PlatformServices.md](PlatformServices.md). A green `/health`
  or a login page that answers is no proof that Pica works.

## Local services for Pica's operator browser

Pica's visual operator browser ([PicaOperatorBrowser](PicaOperatorBrowser.md))
reaches public HTTPS sites and this Pages instance. A local service it may
also test has to be released by exact origin in `config.toml` (a manual edit
that applies after a restart):

```toml
picaBrowserLocalOrigins = ["http://127.0.0.1:8080"] # scheme, host and port, no path
```

An invalid entry makes the server exit with code 1 at the start, like any other
invalid key. Without the key only this instance and the public internet are
reachable.

## Data and runtime directories

```text
~/.pages/
├── config.toml               configuration
├── log/                      private daily operational JSONL files
├── Agents/                   agent definitions and run records
└── data/                     default application data directory
    ├── pages.duckdb          legacy path marker; no runtime database file
    ├── github-token.key      instance key, unless PAGES_GITHUB_TOKEN_KEY is set
    ├── wiki-attachments/     wiki attachments
    ├── assets/               ticket attachments: <ticket-uuid>/<attachment-uuid>.<extension>
    ├── ticket-attachments/   legacy ticket files until the offline migration
    ├── themes/               design themes, one directory each (optional)
    ├── pica-browser-sessions/ saved signed-in sessions of Pica's operator browser, encrypted
    └── agents/               isolated logins of CLI model connections
```

Ticket upload, inventory, backup and the verified offline migration of existing
attachments are described in [Ticket attachments](TicketAssets.md).

`Agents/` sits next to `config.toml`. The key file and the folders below
`data/` always sit in the parent directory of `databasePath`. PostgreSQL storage is separate.

When Pages connects after setup, it applies numbered migrations from
`backend/database/postgres/migrations/` and rejects changed applied migrations.
Historical `backend/database/migrations/` files and the development-only DuckDB
driver belong to offline transfer, not server startup. See
[PostgreSQL migration](PostgresMigration.md) for the separate database backup and
[Ticket attachments](TicketAssets.md) for application files. Back up the instance
key, configuration, login folders and attachments along with PostgreSQL; a
PostgreSQL-only backup cannot restore those files or decrypt stored secrets.
