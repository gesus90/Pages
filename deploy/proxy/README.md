# Reverse proxy and TLS in front of Pages

Pages compares the `Origin` of every change a browser sends (the Pica chat
among them) with the address the request has. That address is built from the
`Host` header and the protocol of the connection. A proxy that ends TLS hands
the request over plain HTTP, so Pages has to be told which protocol the
browser used. This page is the contract for that, for every hop between the
browser and the API.

## The path of a request

```text
browser ── HTTPS ──▶ TLS entry ── HTTP ──▶ [more HTTP hops] ──▶ pages-ingress ──▶ API
                     Caddy, nginx,         nginx, container      :3000            :3100
                     router, balancer      host, ...
```

`pages-ingress.mjs` and the API read the same `trustedProxies` list of the
instance's `config.toml`. Both start from the instance's configuration file
(`--config`), so one value reaches both.

| Header              | Who sets it                         | What every later hop does                            |
| ------------------- | ----------------------------------- | ---------------------------------------------------- |
| `Host`              | the browser                         | passes it on unchanged, with its port (`$http_host`) |
| `X-Forwarded-Proto` | the hop that ends TLS: `https`      | passes it on, but only from a hop it trusts          |
| `X-Forwarded-For`   | each trusted hop appends its client | appends its peer; replaces a value from a stranger   |

Everything else (`Forwarded`, `X-Forwarded-Host`, `X-Forwarded-Port`,
`X-Forwarded-Server`, `X-Forwarded-Ssl`, `X-Real-IP`, `Front-End-Https`,
`X-Url-Scheme`) is dropped by the entrance, because Pages reads none of it.

## The failure this contract prevents

`requireChatRequest` (`app/lib/chat-response.server.ts`) compares the browser's
`Origin` with `new URL(request.url).origin`, and the entrance builds that URL
from `Host` and the protocol of the connection (`PagesServer.ts`, with
`ForwardedProtocol.ts`). Behind a TLS entry, the URL only has `https://` when
the API receives `X-Forwarded-Proto: https` from a trusted peer. An HTTP-only
hop between the TLS entry and Pages that sends `X-Forwarded-Proto $scheme`
turns every request into `http` (its own `$scheme`), so the API expects
`http://pages.example.org` and the browser's `https://pages.example.org` is
refused with 403. That is exactly the shape `nginx-pages.conf.example` variant
B replaces. The code path and this condition are reproducible without any
historic header value; which hop of a given installation loses the protocol is
read from the event `request.origin.rejected` (below), not assumed.

## What Pages believes

- The **entrance** (`pages-ingress.mjs`) believes `X-Forwarded-For` and
  `X-Forwarded-Proto` from a loopback peer and from an address or range of
  `trustedProxies`. For every other peer it replaces both with what it saw
  itself: the peer, and `http`. A client can therefore not choose them.
- The **API**, behind the entrance or facing a proxy itself, believes
  `X-Forwarded-Proto: https` only from an address of `trustedProxies`, and
  `X-Forwarded-For` from those and from loopback. Loopback is _not_ implied
  for the protocol, so the entrance's address must be listed when TLS is ended
  in front of it. For every other peer the headers are replaced the same way.
  Without `trustedProxies` no proxy is trusted for the protocol and nothing
  changes for an installation that is reached directly or without TLS.
- The browser's `Origin` is never the basis of the expected origin. It is only
  compared with it, exactly, for every request. There is no wildcard, no host
  allowlist and no switch that turns the comparison off.

A trusted hop is a statement about **that hop's connection**, not about the
people behind it: list the address Pages sees the proxy connect from.

## Which entries to configure

`trustedProxies` in `config.toml` (a manual edit that applies after a restart
of the API and of the entrance; an invalid entry ends the start of either with
exit code 1):

| Layout                                                              | `trustedProxies`                                                             |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Direct access over HTTP, no proxy                                   | none                                                                         |
| TLS proxy on this host → `pages-ingress` → API                      | `["127.0.0.1", "::1"]`                                                       |
| TLS proxy on another host or in a container → `pages-ingress` → API | the proxy's address, and `"127.0.0.1", "::1"` for the entrance               |
| TLS proxy → `pnpm start` (no entrance)                              | the proxy's address (`"127.0.0.1"` on this host)                             |
| TLS entry → nginx on this host (plain HTTP) → `pages-ingress` → API | `["127.0.0.1", "::1"]`; the TLS entry's address is kept **in nginx** (below) |

The entrance and the API log at their start how many entries they read
(`ingress.forwarding.configured`, `server.forwarding.configured`), so the
active value can be read without opening the file.

## nginx

[`nginx-pages.conf.example`](./nginx-pages.conf.example) holds both variants:

- **A, nginx ends TLS:** `proxy_set_header X-Forwarded-Proto $scheme;` is the
  browser's protocol.
- **B, TLS is ended in front of nginx** (nginx listens on plain HTTP, for
  example on port 8080): `$scheme` is `http` for every request and must not be
  sent, or the browser's `https` is lost at this hop. nginx keeps the value of
  the TLS entry instead, and only when the request comes from that entry's
  address (`geo $pages_trusted_tls_entry`).

In both variants `Host` is `$http_host` (it keeps a port such as `:8443`,
which `$host` drops) and the forwarding headers Pages does not read are
emptied. Caddy's `reverse_proxy` already does the equivalent by default.

## Request bodies: plan files up to 512 MiB

A file of a plan (PAGE-292) travels as one `PUT /agent-api/plan-assets` body of
up to 512 MiB (512 × 1024 × 1024 = 536,870,912 bytes). The plan page refuses a
larger file before it sends anything, and Pages answers a longer body with
`413` and `plan_asset_too_large`, after cutting the stream; nothing is stored
or truncated. A proxy in front limits the body on its own and with a page the
plan page cannot explain, so it must let 512 MiB pass:

- nginx: `client_max_body_size 512m;` (its default is `1m`; `m` is MiB),
  `proxy_request_buffering off;` so the body streams instead of being written
  to the proxy's disk first, and a `client_body_timeout` that a slow uplink can
  meet. Both variants of the example set them.
- Caddy: no body limit by default; do not add `request_body max_size` below
  512 MiB for this route.
- Other balancers and CDNs: raise the request-body limit for `/agent-api/` to
  at least 512 MiB. A larger limit for wiki or ticket uploads in the Pages
  settings needs a matching proxy value.

The entrance (`pages-ingress`) streams bodies without a limit of its own.

## When it does not work

A change whose `Origin` is not the address of the request is refused with HTTP
403. The Pica chat shows a message about the web address and the proxy, not
about missing rights, and the API writes **one** event per refusal
(`request.origin.rejected`, at most 20 per minute) with the request's
`correlationId` (also in the `X-Correlation-ID` response header), the route,
the category and the normalized scheme, host and port of both origins. It holds
no cookie, token, header dump, body, chat text or address of a peer.

```sh
jq -c 'select(.event == "request.origin.rejected") | {time, correlationId, metadata}' \
  /private/instance/log/*.jsonl
```

| `reason`                 | What happened                                                                             | Fix                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `scheme_proxy_untrusted` | The browser used `https`; a proxy said so, but its address is not listed                  | Add the address Pages sees the proxy connect from to `trustedProxies`                 |
| `scheme_not_forwarded`   | The browser used `https`; no hop reported it (header missing, or overwritten with `http`) | Set `X-Forwarded-Proto` on the TLS entry; keep it on every HTTP hop (nginx variant B) |
| `host_mismatch`          | `Host` is not the address in the browser's bar                                            | Pass the browser's `Host` on (`$http_host`), also in the entry hop                    |
| `port_mismatch`          | Same host, but the port was dropped or changed                                            | Pass `Host` with its port; `$host` and some balancers drop it                         |
| `scheme_mismatch`        | The schemes differ in another way                                                         | Check which hop sets `X-Forwarded-Proto`                                              |
| `origin_unreadable`      | The `Origin` header is not a plain `scheme://host[:port]`                                 | Not a Pages setting; look at the client or an intermediary                            |

`forwardedProtocol` in the event is what `X-Forwarded-Proto` said when it
reached Pages (`https`, `http`, `absent`, `invalid`); `isTrustedProxy` tells
whether the connection came from a listed address; `fetchSite` is the
browser's own `Sec-Fetch-Site`.

What the person sees follows the same facts, and both answers are `403`:
`originRejected` ("the web address does not match the setup of the server")
when the cause may be a hop in front of Pages, which is the case when the
browser says the call is same-origin or the request came through a proxy, and
`accessDenied` ("you lack the rights") only for an origin that is foreign with
no hop to blame, such as a browser that says the call is cross-site. Neither
lets a request through, and a missing right is never reported as an address
problem or the other way round. An expired sign-in is a third, separate
message with a link to sign in again; what the person typed stays in the
panel, and nothing is sent again by itself.

## Pica approval of a public address

A green `/health`, a login page that answers `200` or a running service do
not show that Pica works behind the public address. The binding check is in
[docs/PlatformServices.md](../../docs/PlatformServices.md), section
"Pica-Freigabeprüfung": sign in over the address people really use and
confirm that `POST /chat-api` with `{"intent":"open"}` answers JSON with
`"ok": true`.
