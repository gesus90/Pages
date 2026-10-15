import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";

import type { CliSessionMcp } from "@/backend/agents/cli/CliSessionPlans";
import type {
  AgentPlanSessionInput,
  PlanExecution,
  PlanSession,
  PlanSessionObserver,
  PlanSessionClosed,
} from "@/backend/agents/AgentPlanExecution";

interface GroupSession {
  readonly instanceId: string;
  readonly mcp: CliSessionMcp | null;
  readonly fingerprint: string;
  readonly session: PlanSession;
  readonly controller: AbortController;
  readonly started: Parameters<PlanSessionObserver["started"]>[0] | null;
}

interface GroupTurnInput {
  readonly key: string;
  readonly input: AgentPlanSessionInput;
  readonly signal: AbortSignal;
  readonly observer: PlanSessionObserver;
}

function runtimeFingerprint(input: AgentPlanSessionInput): string {
  return JSON.stringify({
    adapter: input.agent.connection.provider,
    connection: input.agent.connection.id,
    model: input.agent.model,
    effort: input.agent.reasoningEffort,
    user: input.userId,
    directory: input.directory,
    access: input.options.access,
    shell: input.options.shell,
    web: input.options.web,
  });
}

/** Holds one process and native session between accepted turns, including while paused. */
export class AgentPlanGroupSessions {
  private readonly sessions = new Map<string, GroupSession>();
  private readonly execution: PlanExecution;

  public constructor(execution: PlanExecution) {
    this.execution = execution;
  }

  /** Returns the original process instance when another step joins its group. */
  public instanceId(key: string): string | undefined {
    return this.sessions.get(key)?.instanceId;
  }

  /** Keeps the original tool server and credential for every step in the session. */
  public mcp(key: string): CliSessionMcp | null {
    return this.sessions.get(key)?.mcp ?? null;
  }

  /** Starts or continues a group without replacing its resolved runtime configuration. */
  public async turn(request: GroupTurnInput): Promise<PlanSession> {
    const { key, input, signal, observer } = request;
    const current = this.sessions.get(key);
    if (input.agent.connection.provider !== "codex_cli")
      throw new AgentError("provider_invalid");
    if (current) {
      if (
        current.fingerprint !== runtimeFingerprint(input) ||
        !current.session.next
      )
        throw new AgentError("plan_context_changed");
      if (current.started) observer.started(current.started);
      const turn = current.session.next(input, signal, observer);
      return { turn, close: () => this.close(key, current) };
    }
    const controller = new AbortController();
    const cancel = (): void => controller.abort();
    signal.addEventListener("abort", cancel, { once: true });
    let started: GroupSession["started"] = null;
    try {
      if (signal.aborted) throw new AgentPlanCancelledError();
      const session = await this.execution.open(
        { ...input, options: { ...input.options, timeoutMinutes: 0 } },
        controller.signal,
        {
          ...observer,
          started: (details) => {
            started = details;
            observer.started(details);
          },
        },
      );
      const entry: GroupSession = {
        session,
        mcp: input.mcp,
        controller,
        started,
        instanceId: input.instanceId,
        fingerprint: runtimeFingerprint(input),
      };
      this.sessions.set(key, entry);
      const turn = session.turn.finally(() =>
        signal.removeEventListener("abort", cancel),
      );
      return { turn, close: () => this.close(key, entry) };
    } catch (error: unknown) {
      signal.removeEventListener("abort", cancel);
      throw error;
    }
  }

  /** Closes idle paused groups as well as an active turn when their plan is stopped. */
  public async stop(
    runId: string,
    groupId?: string,
  ): Promise<
    readonly { readonly key: string; readonly closed: PlanSessionClosed }[]
  > {
    const stopped: { key: string; closed: PlanSessionClosed }[] = [];
    for (const [key, entry] of this.sessions) {
      if (
        !key.startsWith(`${runId}/`) ||
        (groupId !== undefined && key !== `${runId}/${groupId}`)
      )
        continue;
      entry.controller.abort();
      stopped.push({ key, closed: await this.close(key, entry) });
    }
    return stopped;
  }

  private async close(
    key: string,
    entry: GroupSession,
  ): ReturnType<PlanSession["close"]> {
    try {
      return await entry.session.close();
    } finally {
      this.sessions.delete(key);
    }
  }
}
