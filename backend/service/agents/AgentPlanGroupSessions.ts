import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import {
  agentRunOptionsFor,
  isAcpProvider,
} from "@/definition/AgentConfiguration";
import { logCaughtError } from "@/backend/logging/Logger";

import { waitForTurn } from "./AgentPlanTurn";

import type { CliSessionMcp } from "@/backend/agents/cli/CliSessionPlans";
import type {
  AgentPlanSessionInput,
  PlanExecution,
  PlanSession,
  PlanSessionObserver,
  PlanSessionClosed,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { AcpProviderId } from "@/definition/AgentConfiguration";
import type { AgentPlanGroupSessionLink } from "@/definition/AgentPlanSession";
import type { AgentPlanContinuationCapabilities } from "@/definition/AgentPlanRecovery";

interface GroupSession {
  readonly instanceId: string;
  readonly mcp: CliSessionMcp | null;
  readonly fingerprint: string;
  readonly session: PlanSession;
  readonly controller: AbortController;
  readonly started: Parameters<PlanSessionObserver["started"]>[0] | null;
  readonly adapter: AcpProviderId;
  /** The Pages node whose turn opened the session. */
  readonly creatorStepId: string;
  /** Turns sent to the session so far, the opening one included. */
  turns: number;
  /** The ACP session ID, once the adapter issued it. */
  acpSessionId: string | null;
  /** The process ended or was retired; the session cannot be continued. */
  isLost: boolean;
  effective: Readonly<Record<string, string>> | null;
  readonly capabilities: AgentPlanContinuationCapabilities | null;
}

interface GroupTurnInput {
  readonly key: string;
  readonly input: AgentPlanSessionInput;
  readonly signal: AbortSignal;
  readonly observer: PlanSessionObserver;
}

/** A place in the queue of one group's turns. */
export interface GroupTurnSlot {
  /** Resolves once every earlier turn of the group has settled. */
  readonly ready: Promise<void>;
  /** Lets the next turn of the group start; call it exactly once. */
  readonly release: () => void;
}

function runtimeFingerprint(input: AgentPlanSessionInput): string {
  const options = agentRunOptionsFor(
    input.agent.connection.provider,
    input.options,
  );
  return JSON.stringify({
    adapter: input.agent.connection.provider,
    connection: input.agent.connection.id,
    model: input.agent.model,
    effort: input.agent.reasoningEffort,
    user: input.userId,
    directory: input.directory,
    access: options.access,
    shell: options.shell,
    web: options.web,
    browser: options.browser === true,
  });
}

/**
 * Holds one process and ACP session per group and run between accepted turns, including while paused.
 *
 * @remarks
 * The first member that really runs opens the session; every later member
 * continues it with its own step instruction. Turns of one group wait in a
 * queue, so a session never has two active turns. An ACP session ID belongs
 * to the adapter process that issued it: once that process is gone, the
 * group cannot continue, and no second session is opened in its place.
 */
export class AgentPlanGroupSessions {
  private readonly sessions = new Map<string, GroupSession>();
  private readonly opened = new Set<string>();
  private readonly queues = new Map<string, Promise<void>>();
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

  /**
   * Queues a turn of the group behind the earlier ones, in the order of the calls.
   *
   * @param key - The run and group, as `runId/groupId`.
   */
  public reserve(key: string): GroupTurnSlot {
    const previous = this.queues.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.queues.set(
      key,
      previous.then(() => settled),
    );
    return { ready: previous, release };
  }

  /**
   * How the next turn of a group relates to its shared session.
   *
   * @param key - The run and group, as `runId/groupId`.
   * @param step - The member that takes the turn, and the group's adapter class.
   */
  public link(
    key: string,
    step: {
      readonly groupId: string;
      readonly stepId: string;
      readonly adapter: AcpProviderId;
    },
  ): AgentPlanGroupSessionLink {
    const current = this.sessions.get(key);
    return {
      groupId: step.groupId,
      adapter: current?.adapter ?? step.adapter,
      role: current ? "continued" : "created",
      creatorStepId: current?.creatorStepId ?? step.stepId,
      turn: (current?.turns ?? 0) + 1,
      acpSessionId: current?.acpSessionId ?? null,
      nativeSessionId: null,
    };
  }

  /** Starts or continues a group without replacing its resolved runtime configuration. */
  public async turn(request: GroupTurnInput): Promise<PlanSession> {
    const { key, input, signal, observer } = request;
    const current = this.sessions.get(key);
    if (!isAcpProvider(input.agent.connection.provider))
      throw new AgentError("plan_group_session_unsupported");
    if (signal.aborted) throw new AgentPlanCancelledError();
    if (current) return this.continueTurn(key, current, request);
    // A group opens one session per run; a lost one is never replaced silently.
    if (this.opened.has(key)) throw new AgentError("plan_group_session_lost");
    const controller = new AbortController();
    const cancel = (): void => controller.abort();
    signal.addEventListener("abort", cancel, { once: true });
    let started: GroupSession["started"] = null;
    let capabilities: AgentPlanContinuationCapabilities | null = null;
    try {
      if (signal.aborted) throw new AgentPlanCancelledError();
      const holder: { entry: GroupSession | null } = { entry: null };
      this.opened.add(key);
      const session = await this.execution.open(
        { ...input, options: { ...input.options, timeoutMinutes: 0 } },
        controller.signal,
        {
          ...this.watch(holder, observer),
          capabilities: (announced) => {
            capabilities = announced;
            observer.capabilities?.(announced);
          },
          started: (details) => {
            started = details;
            observer.started(details);
          },
        },
      );
      if (!session.next) {
        const closed = await session.close();
        observer.retired?.(closed, "process_exit");
        throw new AgentError("plan_group_session_unsupported");
      }
      const entry: GroupSession = {
        session,
        mcp: input.mcp,
        controller,
        started,
        instanceId: input.instanceId,
        fingerprint: runtimeFingerprint(input),
        adapter: input.agent.connection.provider,
        creatorStepId: input.resourceContext?.stepId ?? "",
        turns: 1,
        acpSessionId: null,
        isLost: false,
        effective: null,
        capabilities,
      };
      holder.entry = entry;
      this.sessions.set(key, entry);
      this.opened.add(key);
      const turn = this.confirmTurn(entry, session.turn).finally(() =>
        signal.removeEventListener("abort", cancel),
      );
      return { turn, close: () => this.close(key, entry) };
    } catch (error: unknown) {
      logCaughtError("AgentPlanGroupSessions", error);

      signal.removeEventListener("abort", cancel);
      throw error;
    }
  }

  /**
   * Runs an executor's instruction as a turn of the group's open session, behind every earlier turn.
   *
   * @param request - The member's input with the instruction as its prompt.
   * @throws {AgentError} `plan_session_unavailable` when the group's session is closed or lost.
   */
  public async instruct(request: GroupTurnInput): Promise<PlanSessionTurn> {
    const slot = this.reserve(request.key);
    try {
      await waitForTurn(slot.ready, request.signal);
      const current = this.sessions.get(request.key);
      if (!current || current.isLost)
        throw new AgentError("plan_session_unavailable");
      const session = await this.continueTurn(request.key, current, request);
      return await session.turn;
    } finally {
      slot.release();
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

  /** Forgets the groups of a finished run; only its own keys are touched. */
  public forget(runId: string): void {
    for (const key of [...this.opened, ...this.queues.keys()])
      if (key.startsWith(`${runId}/`)) {
        this.opened.delete(key);
        this.queues.delete(key);
      }
  }

  private async continueTurn(
    key: string,
    current: GroupSession,
    request: GroupTurnInput,
  ): Promise<PlanSession> {
    const { input, signal, observer } = request;
    if (current.isLost) throw new AgentError("plan_group_session_lost");
    if (
      current.fingerprint !== runtimeFingerprint(input) ||
      !current.session.next
    )
      throw new AgentError("plan_context_changed");
    await input.beforeStart?.();
    if (signal.aborted) throw new AgentPlanCancelledError();
    if (!current.session.next)
      throw new AgentError("plan_group_session_unsupported");
    if (current.started)
      observer.started({
        ...current.started,
        startedAt: new Date().toISOString(),
      });
    current.turns += 1;
    if (current.capabilities) observer.capabilities?.(current.capabilities);
    return {
      turn: this.confirmTurn(
        current,
        current.session.next(
          input,
          signal,
          this.watch({ entry: current }, observer),
        ),
      ),
      close: () => this.close(key, current),
    };
  }

  /** Notes the ACP session ID and a retirement of the process for the group. */
  private watch(
    holder: { readonly entry: GroupSession | null },
    observer: PlanSessionObserver,
  ): PlanSessionObserver {
    return {
      ...observer,
      identified: (sessionId) => {
        const entry = holder.entry;
        if (entry?.acpSessionId && entry.acpSessionId !== sessionId)
          entry.isLost = true;
        else if (entry) entry.acpSessionId = sessionId;
        observer.identified(sessionId);
      },
      retired: (closed, reason) => {
        if (holder.entry) holder.entry.isLost = true;
        observer.retired?.(closed, reason);
      },
    };
  }

  private async confirmTurn(
    entry: GroupSession,
    pending: Promise<PlanSessionTurn>,
  ): Promise<PlanSessionTurn> {
    const turn = await pending;
    if (turn.failure !== null || turn.errorCode !== null) {
      entry.isLost = true;
      return turn;
    }
    const fields = entry.effective
      ? [
          ...new Set([
            ...Object.keys(entry.effective),
            ...Object.keys(turn.effective),
          ]),
        ]
      : [];
    const conflict = fields.find(
      (field) => entry.effective?.[field] !== turn.effective[field],
    );
    if (
      entry.isLost ||
      !turn.sessionId ||
      (entry.acpSessionId && entry.acpSessionId !== turn.sessionId) ||
      conflict
    ) {
      entry.isLost = true;
      return {
        ...turn,
        failure: "failed",
        errorCode: "plan_context_changed",
        events: [
          ...turn.events,
          `group runtime changed: ${conflict ?? "acpSessionId"}`,
        ],
      };
    }
    entry.acpSessionId = turn.sessionId;
    entry.effective = { ...turn.effective };
    return turn;
  }

  private async close(
    key: string,
    entry: GroupSession,
  ): ReturnType<PlanSession["close"]> {
    try {
      return await entry.session.close();
    } catch (error: unknown) {
      logCaughtError("AgentPlanGroupSessions", error);

      return {
        exit: null,
        endedAt: new Date().toISOString(),
        leftovers: 0,
        isConfirmed: false,
      };
    } finally {
      this.sessions.delete(key);
    }
  }
}
