import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ConversationObserverError } from "@/backend/error/ConversationObserverError";
import { logCaughtError } from "@/backend/logging/Logger";
import { CONVERSATION_DECISION_LIMITS } from "@/definition/ConversationDecision";

import { turnFailureCode } from "../agents/AgentPlanSessionRecords";
import { decisionPrompt } from "./ConversationDecisionPrompt";

import type {
  PlanExecution,
  PlanSession,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type { SimulatedConversationDecision } from "@/backend/agents/simulation/SimulatedConversationDecision";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type { ChatDecisionSettingsService } from "../chat/ChatDecisionSettingsService";
import type { DecisionMaterial } from "./ConversationDecisionPrompt";

const COMPONENT = "ConversationDecisionModel";

/** Read-only, no command, no web: the model reads its prompt and answers. */
const DECISION_RUN_OPTIONS: AgentRunOptions = {
  access: "read_only",
  shell: false,
  web: false,
  timeoutMinutes: 2,
};

const OBSERVER: PlanSessionObserver = {
  started: () => undefined,
  identified: () => undefined,
};

/** One question to the decision model. */
export interface ConversationDecisionQuestion {
  /** The person whose message is judged; the session runs for them. */
  readonly personId: string;
  readonly material: DecisionMaterial;
}

/** What the decision model runs on. */
export interface ConversationDecisionModelDependencies {
  /** The decision model of the instance. */
  readonly settings: Pick<ChatDecisionSettingsService, "resolve">;
  /** The ACP path; `null` where the server runs none. */
  readonly plans: Pick<PlanExecution, "open"> | null;
  /** The simulated model; set only while the simulation is on. */
  readonly simulation: SimulatedConversationDecision | null;
}

/**
 * Asks the decision model of the instance which agents answer (PAGE-317).
 *
 * @remarks
 * The call runs in a short ACP session of its own in an empty directory:
 * read-only, without any tool, web or MCP server, and with a hard deadline.
 * It gets the prompt of {@link decisionPrompt} and nothing else, no
 * credentials and no memory. No call is repeated.
 */
export class ConversationDecisionModel {
  private readonly dependencies: ConversationDecisionModelDependencies;

  public constructor(dependencies: ConversationDecisionModelDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Asks once.
   *
   * @returns The text of the answer, still to be read by the caller.
   * @throws {ConversationObserverError} `decision_no_model` while no model is
   * chosen or it cannot run, `observer_unavailable` where no ACP path exists,
   * or the code of the failed session.
   */
  public async ask(question: ConversationDecisionQuestion): Promise<string> {
    const assignment = await this.dependencies.settings.resolve();
    if (assignment === null)
      throw new ConversationObserverError("decision_no_model");
    const { simulation, plans } = this.dependencies;
    if (simulation) return simulation.decide(question.material);
    if (!plans) throw new ConversationObserverError("observer_unavailable");
    const directory = await mkdtemp(path.join(tmpdir(), "pages-decision-"));
    let session: PlanSession | null = null;
    try {
      const prompt = decisionPrompt(question.material);
      session = await plans.open(
        {
          agent: assignment,
          userId: question.personId,
          directory,
          prompt: `${prompt.instructions}\n\n${prompt.prompt}`,
          options: DECISION_RUN_OPTIONS,
          instanceId: randomUUID(),
          mcp: null,
          purpose: "decision",
        },
        AbortSignal.timeout(CONVERSATION_DECISION_LIMITS.timeoutSeconds * 1000),
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
}
