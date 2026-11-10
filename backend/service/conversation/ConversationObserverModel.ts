import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { ChatError } from "@/backend/error/ChatErrors";
import { ConversationObserverError } from "@/backend/error/ConversationObserverError";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { CONVERSATION_OBSERVER_LIMITS } from "@/definition/ConversationObserver";

import { turnFailureCode } from "../agents/AgentPlanSessionRecords";
import { picaAcpRunner } from "../chat/acp/PicaAcpRunners";

import type { Usage } from "@agentclientprotocol/sdk";
import type { AcpSessionListener } from "@/backend/agents/acp/AcpChat";
import type {
  PlanExecution,
  PlanSession,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type { SimulatedConversationObserver } from "@/backend/agents/simulation/SimulatedConversationObserver";
import type { ConversationObserverRunRepository } from "@/backend/database/repositories/conversation/ConversationObserverRunRepository";
import type { ResolvedAgentAssignment } from "../agents/AgentAssignmentResolution";
import type { PicaSettingsService } from "../chat/PicaSettingsService";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type {
  ObserverPrompt,
  RoutingMaterial,
  SummaryMaterial,
} from "./ConversationObserverPrompts";

const COMPONENT = "ConversationObserverModel";

/**
 * Read-only, no command, no web, a hard deadline: an observer session reads
 * its prompt and answers, whatever Pica's own chat may do.
 */
const OBSERVER_RUN_OPTIONS: AgentRunOptions = {
  access: "read_only",
  shell: false,
  web: false,
  timeoutMinutes: CONVERSATION_OBSERVER_LIMITS.observerTimeoutMinutes,
};

/** Waits a minute longer than the session deadline before it gives up. */
const OUTER_TIMEOUT_MILLISECONDS =
  (CONVERSATION_OBSERVER_LIMITS.observerTimeoutMinutes + 1) * 60_000;

const OBSERVER: PlanSessionObserver = {
  started: () => undefined,
  identified: () => undefined,
};

/** One question to the observer. */
export interface ConversationObserverQuestion {
  readonly conversationId: string;
  /**
   * The people whose new content causes the call, the most relevant first;
   * the first whose access Pica's connection admits is used, checked again
   * right before the call. Nobody else ever stands in.
   */
  readonly personIds: readonly string[];
  /** The message or sequence range the call is for; stored with its outcome. */
  readonly trigger: string;
  readonly prompt: ObserverPrompt;
  /** The structured material, which the simulation answers instead of a model. */
  readonly material:
    | { readonly kind: "routing"; readonly routing: RoutingMaterial }
    | { readonly kind: "summary"; readonly summary: SummaryMaterial };
}

/** What the observer runs on. */
export interface ConversationObserverModelDependencies {
  /** Pica's central model choice and its authorized resolver. */
  readonly pica: Pick<PicaSettingsService, "resolve" | "requireCurrent">;
  /** The ACP path; `null` where the server runs none. */
  readonly plans: Pick<PlanExecution, "open"> | null;
  readonly runs: Pick<ConversationObserverRunRepository, "record">;
  /** The simulated observer; set only while the simulation is on. */
  readonly simulation: SimulatedConversationObserver | null;
  readonly now?: () => Date;
}

/** The person a call runs for and Pica's choice resolved for them. */
interface ObserverCall {
  readonly personId: string;
  readonly assignment: ResolvedAgentAssignment;
}

interface TokenUsage {
  input: number | null;
  output: number | null;
  total: number | null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Collects the token usage the adapter reports, the only measurement an ACP runner gives. */
function usageListener(usage: TokenUsage): AcpSessionListener {
  return {
    update: () => undefined,
    prompted: (reported: Usage | null) => {
      if (reported === null) return;
      if (isCount(reported.inputTokens))
        usage.input = (usage.input ?? 0) + reported.inputTokens;
      if (isCount(reported.outputTokens))
        usage.output = (usage.output ?? 0) + reported.outputTokens;
      if (isCount(reported.totalTokens))
        usage.total = (usage.total ?? 0) + reported.totalTokens;
    },
    closed: () => undefined,
  };
}

/** The stable code of a refusal to resolve Pica's model. */
function resolutionCode(error: unknown): string {
  if (error instanceof ChatError && error.code === "disabled")
    return "pica_disabled";
  if (error instanceof AgentExecutionError) {
    if (error.code === "roleMissing") return "pica_model_missing";
    if (error.code === "accessDenied") return "pica_access_denied";
    return "pica_model_unavailable";
  }
  if (error instanceof ChatError) return "pica_model_unavailable";
  return "observer_unavailable";
}

/** The stable code of a failed call, without any detail of prompt or provider. */
function failureCode(error: unknown): string {
  if (error instanceof ConversationObserverError) return error.code;
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-zA-Z_]{1,60}$/u.test(error.code)
  )
    return error.code;
  return "observer_failed";
}

/**
 * Asks Pica's chat model as the group observer (PAGE-296).
 *
 * @remarks
 * Every call resolves Pica's current choice through Pica's authorized
 * resolver for the person whose content causes it: no other model, no other
 * person and no fallback. The call runs apart from Pica's sessions, memory,
 * `SOUL.md` and tools, in a short ACP session of its own in an empty
 * directory, read-only, without any tool, web or MCP server, and Pica's run
 * mode is never adopted. Each call is stored with its outcome and the token
 * usage its runner reported, never with prompt or answer. No call is
 * repeated.
 */
export class ConversationObserverModel {
  private readonly dependencies: ConversationObserverModelDependencies;

  public constructor(dependencies: ConversationObserverModelDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Asks one question.
   *
   * @returns The text of the answer, still to be validated by the caller.
   * @throws {ConversationObserverError} When Pica is off, its choice is
   * missing or not the person's to use, or the call failed.
   */
  public async ask(question: ConversationObserverQuestion): Promise<string> {
    const startedAt = this.now();
    const resolved = await this.resolve(question.personIds);
    if ("code" in resolved) {
      await this.record(question, {
        personId: question.personIds[0] ?? "",
        assignment: null,
        state: "refused",
        code: resolved.code,
        startedAt,
        usage: null,
      });
      throw new ConversationObserverError(resolved.code);
    }
    const { personId, assignment } = resolved;
    const usage: TokenUsage = { input: null, output: null, total: null };
    const call = { question, personId, assignment };
    try {
      const output = await this.answer(call, usage);
      await this.record(question, {
        personId,
        assignment,
        state: "succeeded",
        code: null,
        startedAt,
        usage,
      });
      return output;
    } catch (error: unknown) {
      const code = failureCode(error);
      await this.record(question, {
        personId,
        assignment,
        state: "failed",
        code,
        startedAt,
        usage,
      });
      throw new ConversationObserverError(code);
    }
  }

  /** The first person whose access admits Pica's current choice, with it; or why nobody's does. */
  private async resolve(
    personIds: readonly string[],
  ): Promise<ObserverCall | { readonly code: string }> {
    let code = "observer_no_person";
    for (const personId of new Set(personIds)) {
      try {
        const assignment = await this.dependencies.pica.resolve(personId);
        // Pica's runner must accept the choice; its own run mode stays out.
        picaAcpRunner(assignment).runOptions(assignment);
        return { personId, assignment };
      } catch (error: unknown) {
        code = resolutionCode(error);
        // Pica off or without a choice refuses everybody alike.
        if (code !== "pica_access_denied") return { code };
      }
    }
    return { code };
  }

  private async answer(
    call: ObserverCall & { readonly question: ConversationObserverQuestion },
    usage: TokenUsage,
  ): Promise<string> {
    const { simulation } = this.dependencies;
    const { material } = call.question;
    if (simulation)
      return material.kind === "routing"
        ? simulation.route(material.routing)
        : simulation.summarize(material.summary);
    return this.session(call, usage);
  }

  private async session(
    call: ObserverCall & { readonly question: ConversationObserverQuestion },
    usage: TokenUsage,
  ): Promise<string> {
    const { question, personId, assignment } = call;
    const { plans, pica } = this.dependencies;
    if (!plans) throw new ConversationObserverError("observer_unavailable");
    const directory = await mkdtemp(path.join(tmpdir(), "pages-observer-"));
    let session: PlanSession | null = null;
    try {
      session = await plans.open(
        {
          agent: assignment,
          userId: personId,
          directory,
          prompt: `${question.prompt.instructions}\n\n${question.prompt.prompt}`,
          options: OBSERVER_RUN_OPTIONS,
          instanceId: randomUUID(),
          mcp: null,
          purpose: "observer",
          journal: usageListener(usage),
          beforeStart: () => pica.requireCurrent(personId, assignment),
        },
        AbortSignal.timeout(OUTER_TIMEOUT_MILLISECONDS),
        OBSERVER,
      );
      const turn = await session.turn;
      const failure = turnFailureCode(turn);
      if (failure !== null) throw new ConversationObserverError(failure);
      return turn.output;
    } finally {
      await session?.close().catch((error: unknown) => {
        logCaughtError(COMPONENT, error);
      });
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async record(
    question: ConversationObserverQuestion,
    outcome: {
      readonly personId: string;
      readonly assignment: ResolvedAgentAssignment | null;
      readonly state: "succeeded" | "failed" | "refused";
      readonly code: string | null;
      readonly startedAt: string;
      readonly usage: TokenUsage | null;
    },
  ): Promise<void> {
    const { assignment, usage } = outcome;
    try {
      await this.dependencies.runs.record({
        id: randomUUID(),
        conversationId: question.conversationId,
        kind: question.material.kind,
        trigger: question.trigger,
        personId: outcome.personId,
        connectionId: assignment?.connection.id ?? null,
        model: assignment?.model ?? null,
        state: outcome.state,
        errorCode: outcome.code,
        inputTokens: usage?.input ?? null,
        outputTokens: usage?.output ?? null,
        totalTokens: usage?.total ?? null,
        startedAt: outcome.startedAt,
        endedAt: this.now(),
      });
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
    }
    if (outcome.state === "succeeded") return;
    logEvent({
      level: "warn",
      event: "conversation.observer.failed",
      component: COMPONENT,
      message: "The group observer gave no result.",
      metadata: {
        conversationId: question.conversationId,
        kind: question.material.kind,
        code: outcome.code,
      },
    });
  }

  private now(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }
}
