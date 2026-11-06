#!/usr/bin/env bash
# Keep SQL readiness independent of application availability and provider configuration.
set -eu
: "${PG_BIN:?PG_BIN is required}" "${PGDATA:?PGDATA is required}"
: "${PGHOST:?PGHOST is required}" "${PGPORT:?PGPORT is required}"
mkdir -p "$PGHOST"
chmod 700 "$PGHOST"
"$PG_BIN/postgres" -D "$PGDATA" -k "$PGHOST" -p "$PGPORT" &
postgresPid=$!
isReady=false

stopPostgres() {
  # This is the direct child created above, never a PID read from shared state.
  kill -INT "$postgresPid" 2>/dev/null || true
  wait "$postgresPid" || true
  exit 0
}
trap stopPostgres TERM INT

while kill -0 "$postgresPid" 2>/dev/null; do
  if reply=$(PGCONNECT_TIMEOUT=3 timeout 5 "$PG_BIN/psql" -X -w -qAt -d postgres -c 'SELECT 1;' 2>/dev/null) && [ "$reply" = 1 ]; then
    if [ -n "${NOTIFY_SOCKET:-}" ]; then
      if [ "$isReady" = false ]; then
        /usr/bin/systemd-notify --pid="$$" --ready WATCHDOG=1
        isReady=true
      else
        /usr/bin/systemd-notify --pid="$$" WATCHDOG=1
      fi
    fi
  fi
  sleep 10 &
  wait $! || true
done
wait "$postgresPid"
