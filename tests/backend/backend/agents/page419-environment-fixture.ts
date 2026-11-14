/** Parent-service state that must never cross into another service's environment file. */
export const SYSTEMD_ENVIRONMENT = {
  INVOCATION_ID: "a".repeat(32),
  SYSTEMD_EXEC_PID: "111",
  NOTIFY_SOCKET: "/synthetic/notify",
  WATCHDOG_PID: "111",
  WATCHDOG_USEC: "1000000",
  JOURNAL_STREAM: "8:123",
  MEMORY_PRESSURE_WATCH: "/synthetic/memory.pressure",
  MEMORY_PRESSURE_WRITE: "synthetic-pressure",
  LISTEN_PID: "111",
  LISTEN_FDS: "2",
  LISTEN_FDNAMES: "synthetic-sockets",
  MAINPID: "111",
  MANAGERPID: "99",
};
