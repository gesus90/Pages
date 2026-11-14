const SYSTEMD_SERVICE_VARIABLES: ReadonlySet<string> = new Set([
  "INVOCATION_ID",
  "SYSTEMD_EXEC_PID",
  "NOTIFY_SOCKET",
  "WATCHDOG_PID",
  "WATCHDOG_USEC",
  "JOURNAL_STREAM",
  "MEMORY_PRESSURE_WATCH",
  "MEMORY_PRESSURE_WRITE",
  "LISTEN_PID",
  "LISTEN_FDS",
  "LISTEN_FDNAMES",
  "MAINPID",
  "MANAGERPID",
]);

/** Copies a host environment without identity, notification or activation state owned by its systemd service. */
export function omitSystemdServiceEnvironment(
  environment: NodeJS.ProcessEnv,
): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const [name, configured] of Object.entries(environment)) {
    if (configured !== undefined && !SYSTEMD_SERVICE_VARIABLES.has(name))
      inherited[name] = configured;
  }
  return inherited;
}
