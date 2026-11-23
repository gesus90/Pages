# Static app entrance

The Pages interface is a static app without server rendering.
`node pages-ingress.mjs --config /absolute/config.toml --listen <address>:<port> --backend http://127.0.0.1:<api-port>`
starts its entrance from the same versioned build as the API. nginx or another
web server is not required.

The entrance

- answers the hashed files below `/assets/` (`immutable`), the service worker
  `sw.js` (`no-cache`) and, for every page address, the app's `index.html`
  (`no-cache`, with the security headers of Pages);
- passes everything else to the API: changes (every method but `GET` and
  `HEAD`), React Router data requests (`*.data`), the server resources of
  `app/routes.ts` such as `/api/v1/*`,
  `/live-changes` (event stream, unbuffered), attachments, and WebSocket
  upgrades of runners and consoles;
- passes `/live-changes` to `pages-core` instead when started with
  `--core http://127.0.0.1:<core-port>` (`deploy/core/README.md`);
  without `--core` the API serves it as before. `/api/core/` is never passed
  on;
- passes `/service-status` and `/service-status/details` to `pages-core` when
  started with `--service-status http://127.0.0.1:<core-port>`;
  without it both answer `404`, and the API never serves them;
- passes the WebSocket upgrades of runners (`/runner/v1/channel/<id>`) to
  `pages-core` when started with `--core-runner http://127.0.0.1:<core-port>`,
  and those of the consoles (`…/console/socket`, `…/setup/socket`) with
  `--core-console http://127.0.0.1:<core-port>`; each switch on its
  own, without it the API answers as before. An upgrade below `/api/core/` is
  refused with `404`;
- passes the Pica chat and conversation attachment routes to the Mobile
  gateway when started with `--mobile-files http://127.0.0.1:<mobile-port>`.
  The gateway still authenticates the app and checks access to each file.
  Uploads stream through the entrance, and the gateway's status and headers
  go back to the app;
- keeps `Host`, cookies, status codes, redirects and content types, sets
  `X-Forwarded-For` to the client it saw and `X-Forwarded-Proto` to `http`
  unless a trusted proxy sent them: a proxy on the same host (loopback) or an
  address of `trustedProxies` in the instance's `config.toml`, the key the API
  reads as well. It replaces a stranger's `X-Forwarded-*` and drops `Forwarded`
  and the other forwarding headers Pages does not read
  ([deploy/proxy/README.md](../proxy/README.md));
- holds no session and opens no database. While the API is stopped it still
  serves the app, which then shows what the browser keeps; requests for the
  API answer `502`.

It reads the build from disk on every request: a new build in `build/client`
is served at once, and browsers load it on their next visit without clearing
any cache.

## Switching a running instance over

The switch of a live server is done together with the owner and is not part of
the repository change. The template `pages-ingress@.service` expects:

1. The API on a loopback port: `listenAddress = "127.0.0.1"` and `port` in
   `/etc/pages/<instance>/config.toml`, matching `PAGES_INGRESS_BACKEND`.
2. The public address in `PAGES_INGRESS_LISTEN` (default `0.0.0.0:3000`),
   optionally in `/etc/pages/<instance>/ingress.env`.
3. With TLS in front of the entrance: the entrance's address `127.0.0.1` (and
   `::1`) in the API's `trustedProxies`, so the API believes the forwarded
   `https`. The entrance passes `X-Forwarded-*` on only from a proxy on the
   same host or from an address of the same `trustedProxies` list, so a TLS
   proxy on another host or in a container is listed there as well. An nginx
   between the TLS entry and the entrance keeps the entry's
   `X-Forwarded-Proto` instead of sending its own `$scheme`
   ([deploy/proxy/nginx-pages.conf.example](../proxy/nginx-pages.conf.example)).
   The entrance and the API log how many entries they read at their start.
4. `systemctl enable --now pages-ingress@<instance>`; add it to
   `pages.target` once the switch is made.
5. Before the switch counts as done, run the Pica approval of the public
   address ([docs/PlatformServices.md](../../docs/PlatformServices.md),
   "Pica-Freigabeprüfung"). The service worker answering, `/health` and the
   login page are no proof that Pica works behind that address.

The service worker needs a secure context: HTTPS, or `localhost`.

## Pica Mobile attachments behind HTTPS

If the app uses the public HTTPS origin for file transfers, set
`PAGES_INGRESS_MOBILE_FILES_OPTION="--mobile-files http://127.0.0.1:<mobile-port>"`
in the instance's `ingress.env`. Use the Mobile gateway's reachable
`picaMobilePort`. With `pages-core` relaying Mobile connections, use the
port held by the core (`picaMobilePort`), since the API's relay listener
expects the core's own connection format. Keep the origin in `ingress.env`
in sync when the gateway port changes. Apply the setting on the next
entrance restart. The existing WebSocket routing is independent of this
option.

Keep `/etc/pages/<instance>/ingress.env` across releases. When activating a
new Pages release, install its `pages-ingress@.service` template, reload the
systemd manager, and restart the entrance on the new bundle. This keeps the
instance's configured `--mobile-files` argument when the release changes.

After rollout approval, verify the running build and the entrance's start
arguments. Send an unauthenticated `PUT /pica-mobile/chat/attachments` and
`POST /pica-mobile/chat-page-api/files` to the public HTTPS origin. Both must
return `401 accessDenied`. Then upload the same test file while signed in to
Pica and to a regular chat using the existing APK.
