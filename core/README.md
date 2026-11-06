# pages-core (Rust)

The live-stream service of Pages (PAGE-237), which also reports the state of
the platform's services (PAGE-238) and relays the WebSocket connections of
Pica Mobile, runners and consoles (PAGE-239). What it does and how an instance
switches to it: [deploy/core/README.md](../deploy/core/README.md). The contract
with `pages-api` is `definition/PagesCoreContract.ts`; `src/contract.rs`
mirrors it.

This directory is its own Cargo project. The Pages `pnpm` scripts never build
or check it, so Pages works without a Rust toolchain; a Pages change does not
need Cargo, and a core change does not need `pnpm`.

## Checks and build

Run from `core/` with Rust 1.85 or newer:

```sh
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo build --release --locked
```

`Cargo.lock` is committed; `--locked` refuses a changed dependency set. The
lints of `Cargo.toml` deny every Clippy warning, `unwrap` and `expect`, and
forbid `unsafe`. The binary is `target/release/pages-core`; `target/` is
generated output and never committed.

## Start

```sh
pages-core --config /etc/pages/<instance>/config.toml \
  --listen 127.0.0.1:3200 --api http://127.0.0.1:3100 [--max-connections 4096] \
  [--status-target pages.target [--status-bus system|user]]
```

It reads `databaseUrl` and `pagesCoreSecret` from the configuration and needs
a finished setup with migration 015 (`pages_event_outbox`). It relays the
runner and console upgrades the entrance passes on to the API given by
`--api`; with `picaMobileRelayPort` in the configuration it also listens on
`picaMobilePort`. `GET /health/live`
answers `ok` while the process runs. With `--status-target` it serves
`GET /service-status` and `GET /service-status/details` from the systemd
manager on the named bus (default `system`).
