# Pair first, then configure the stdio client

The JSON and TOML files in this directory configure later stdio starts.
Replace their synthetic absolute bundle path with your actual built file and
`PAGES_URL` with a Pages address reachable by both the adapter and your browser.
The loopback address in the examples works only on the machine running Pages.
Follow the address rules in the [package README](../../README.md#1-choose-a-reachable-pages-instance).

Before starting the client, run the bundle once in your terminal under the same
operating-system account and configuration location that will run the client:

```sh
node /absolute/path/pages-mcp-vX.Y.Z.cjs pair --url http://127.0.0.1:3000 --name "Example workstation"
```

Open the displayed Pages link if the browser does not open automatically. Sign in,
compare the code, check your account and the requesting client, then explicitly
approve the connection. The terminal must stay open until the command verifies
and privately saves the credential. Signing in alone does not approve it. For
SSH or manual browser opening, add `--no-browser`. The code can also be entered
on the displayed Pages pairing page. No credential is shown or copied.

Install the appropriate example in your client's local configuration after
pairing succeeds. The client launches `node` with only the bundle path; it
exchanges protocol messages through stdio. Keep `pair`, `--url` and `--no-browser`
out of these startup arguments. `PAGES_URL` selects the exact normalized instance
whose credential the adapter loads automatically. Leave `PAGES_TOKEN` unset,
including in the parent process, for this browser-paired setup.

Use `status`, `rotate` and `unpair` separately in the terminal as described in
[credential lifecycle](../../README.md#credential-status-rotation-and-removal).
An invalid or ended connection requires pairing again. No interactive setup runs
inside the client's stdio session; diagnostics go to stderr.
