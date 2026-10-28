/** Fields of a synthetic persisted record. */
export type RecordFields = Readonly<Record<string, unknown>>;

/** A hex SHA-256 digest. */
export const DIGEST = "a".repeat(64);

/** A UUID for identifiers that must be one. */
export const UUID = "00000000-0000-4000-8000-000000000001";

/** A valid stored script process record. */
export const SCRIPT_RUN = {
  attemptId: UUID,
  instanceId: UUID,
  interpreterProfileId: "python",
  directory: "/work",
  userId: "owner",
  uid: 1000,
  gid: 1000,
  processId: 42,
  startedAt: "2026-10-20 10:00:00",
  endedAt: null,
  exitCode: 0,
  signal: null,
  failure: null,
  closeout: "confirmed",
  stdout: "out",
  stderr: "",
};

/** The smallest valid session record of an agent node. */
export function sessionRecord(changes: RecordFields = {}): RecordFields {
  return {
    runner: "codex_cli",
    mode: "one_shot",
    instanceId: "instance",
    closeout: "confirmed",
    resultCode: 0,
    requested: {
      runner: "codex_cli",
      connectionId: "connection",
      connectionName: "Codex",
      model: "gpt-5",
      unattended: "never",
      mcp: false,
    },
    events: [],
    ...changes,
  };
}

/** A valid stored node result without optional parts. */
export function stepResult(changes: RecordFields = {}): RecordFields {
  return {
    id: "s1",
    name: "Step",
    status: "succeeded",
    cancellation: "none",
    isBlocked: false,
    output: "done",
    error: null,
    ...changes,
  };
}
