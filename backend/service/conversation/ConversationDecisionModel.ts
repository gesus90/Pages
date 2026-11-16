import { ConversationObserverError } from "@/backend/error/ConversationObserverError";
import { DecisionModelError } from "@/backend/error/DecisionModelError";

import {
  decisionQuestions,
  readDecisionProbabilities,
} from "./ConversationDecisionPrompt";

import type { SimulatedConversationDecision } from "@/backend/agents/simulation/SimulatedConversationDecision";
import type { ChatDecisionSettingsService } from "../chat/ChatDecisionSettingsService";
import type { DecisionModelCalls } from "../chat/DecisionModelCalls";
import type {
  DecisionMaterial,
  DecisionProbabilities,
} from "./ConversationDecisionPrompt";

/** What the decision model gave for one message. */
export interface ConversationDecisionAnswer {
  /** The model build that answered. */
  readonly model: string;
  readonly probabilities: DecisionProbabilities;
  /** What the call cost in US dollars; `null` when the provider stated none. */
  readonly costUsd: number | null;
}

/** What the decision model runs on. */
export interface ConversationDecisionModelDependencies {
  /** The decision model of the instance. */
  readonly settings: Pick<ChatDecisionSettingsService, "resolve">;
  /** Calls the model with the key of its OpenRouter connection. */
  readonly calls: Pick<DecisionModelCalls, "decide">;
  /** The simulated model; set only while the simulation is on. */
  readonly simulation: SimulatedConversationDecision | null;
}

/**
 * Asks the decision model of the instance which agent a message means.
 * @remarks
 * One call to the decisions interface of OpenRouter, not to the chat
 * endpoint, with the key of the OpenRouter connection the model belongs to.
 * It stands two typed questions, a yes/no question and a choice among the
 * agents and nobody, and gives back probabilities; Pages decides with its
 * thresholds. No call is repeated, and no prompt or key is logged.
 */
export class ConversationDecisionModel {
  private readonly dependencies: ConversationDecisionModelDependencies;

  public constructor(dependencies: ConversationDecisionModelDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Asks once.
   * @param material - The agents, the newest messages and the new message.
   * @returns The probabilities of both questions, the model that gave them
   * and the cost of the call.
   * @throws {ConversationObserverError} `decision_no_model` while no model is
   * chosen or its key is unusable, or another code of the decision call
   * (`decision_timeout`, `decision_key_invalid`, `decision_invalid`, …) for a
   * call that gave no valid answer.
   */
  public async ask(
    material: DecisionMaterial,
  ): Promise<ConversationDecisionAnswer> {
    const assignment = await this.dependencies.settings.resolve();
    if (assignment === null)
      throw new ConversationObserverError("decision_no_model");
    const { simulation, calls } = this.dependencies;
    if (simulation)
      return {
        model: "simulation",
        probabilities: simulation.decide(material),
        costUsd: null,
      };
    const { state, questions } = decisionQuestions(material);
    try {
      const response = await calls.decide({
        connectionId: assignment.connectionId,
        model: assignment.model,
        state,
        questions,
      });
      return {
        model: response.model,
        probabilities: readDecisionProbabilities(response, material.candidates),
        costUsd: response.costUsd,
      };
    } catch (error: unknown) {
      if (error instanceof DecisionModelError)
        throw new ConversationObserverError(error.code);
      throw error;
    }
  }
}
