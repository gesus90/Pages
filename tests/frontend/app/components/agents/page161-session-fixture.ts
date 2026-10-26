import type {
  AgentSessionEvent,
  AgentSessionView,
} from "@/definition/AgentSessionJournal";

const UNKNOWN = { value: null, source: null, reportedAt: null } as const;

/** A complete read contract without a process, model call or network integration. */
export const SESSION_VIEW: AgentSessionView = {
  key: {
    planId: "plan-page161",
    runId: "run-page161",
    stepId: "node",
    attemptId: "attempt-page161",
  },
  provider: "codex_cli",
  state: "running",
  groupId: null,
  workspace: null,
  model: {
    requestedModel: UNKNOWN,
    requestedReasoning: UNKNOWN,
    confirmedModel: UNKNOWN,
    confirmedReasoning: UNKNOWN,
  },
  context: {
    contextUsed: null,
    contextLimit: null,
    percent: null,
    source: null,
    reportedAt: null,
  },
  turns: [],
  totals: [],
  runTotals: [],
  messages: [],
  continuation: {
    mode: "unavailable",
    reason: "remote_one_shot",
    hasPlanCheckpoint: false,
  },
  actions: {
    canSend: false,
    canCancelRun: false,
    canCancelTurn: false,
    canRecover: false,
  },
};

/** A short sequence-addressed event, with selectable Unicode text. */
export function historyEvent(sequence: number): AgentSessionEvent {
  return {
    id: `attempt-page161:${sequence}`,
    attemptId: "attempt-page161",
    stepId: "node",
    sequence,
    turn: 1,
    kind: "agent_message",
    text: `Message ${sequence} 🙂`,
    createdAt: "2026-10-26T00:00:00.000Z",
    isTruncated: false,
  };
}

/** An EventSource boundary controlled explicitly by the unit test. */
export class SessionEventSource extends EventTarget {
  public static readonly CLOSED = 2;
  public static readonly instances: SessionEventSource[] = [];
  public readonly url: string;
  public readyState = 1;
  public onopen: (() => void) | null = null;
  public onerror: (() => void) | null = null;

  public constructor(url: string) {
    super();
    this.url = url;
    SessionEventSource.instances.push(this);
  }

  /** Emits a complete public journal record. */
  public send(sequence: number): void {
    this.dispatchEvent(
      new MessageEvent("session", {
        data: JSON.stringify(historyEvent(sequence)),
      }),
    );
  }

  /** Marks a closed transport without touching any real server. */
  public close(): void {
    this.readyState = SessionEventSource.CLOSED;
  }
}
