import { ConversationObserverError } from "@/backend/error/ConversationObserverError";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  decisionQuestions,
  readDecisionProbabilities,
} from "./ConversationDecisionPrompt";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { SimulatedConversationDecision } from "@/backend/agents/simulation/SimulatedConversationDecision";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { ChatDecisionSettingsService } from "../chat/ChatDecisionSettingsService";
import type {
  DecisionMaterial,
  DecisionProbabilities,
} from "./ConversationDecisionPrompt";
import type { OpenRouterDecisionsClient } from "./OpenRouterDecisionsClient";

const COMPONENT = "ConversationDecisionModel";

/** What the decision model gave for one message. */
export interface ConversationDecisionAnswer {
  /** The model build that answered. */
  readonly model: string;
  readonly probabilities: DecisionProbabilities;
}

/** What the decision model runs on. */
export interface ConversationDecisionModelDependencies {
  /** The decision model of the instance. */
  readonly settings: Pick<ChatDecisionSettingsService, "resolve">;
  /** Where the key of its OpenRouter connection is stored. */
  readonly connections: Pick<AgentConnectionRepository, "findSecretEncrypted">;
  readonly cipher: Pick<InstanceSecretCipher, "decrypt">;
  /** The decisions interface of OpenRouter; swapped for a stub in tests. */
  readonly client: Pick<OpenRouterDecisionsClient, "decide">;
  /** The simulated model; set only while the simulation is on. */
  readonly simulation: SimulatedConversationDecision | null;
}

/**
 * Asks the decision model of the instance which agent a message means
 * (PAGE-379).
 *
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
   *
   * @param material - The agents, the newest messages and the new message.
   * @returns The probabilities of both questions and the model that gave them.
   * @throws {ConversationObserverError} `decision_no_model` while no model is
   * chosen or its key is unusable, `decision_unreachable`, `decision_failed`
   * or `decision_invalid` for a call that gave no valid answer.
   */
  public async ask(
    material: DecisionMaterial,
  ): Promise<ConversationDecisionAnswer> {
    const assignment = await this.dependencies.settings.resolve();
    if (assignment === null)
      throw new ConversationObserverError("decision_no_model");
    const { simulation, client } = this.dependencies;
    if (simulation)
      return {
        model: "simulation",
        probabilities: simulation.decide(material),
      };
    const apiKey = await this.readApiKey(assignment.connectionId);
    if (apiKey === null)
      throw new ConversationObserverError("decision_no_model");
    const { state, questions } = decisionQuestions(material);
    const response = await client.decide({
      apiKey,
      model: assignment.model,
      state,
      questions,
    });
    return {
      model: response.model,
      probabilities: readDecisionProbabilities(response, material.candidates),
    };
  }

  // A key that is missing or no longer decrypts makes the model unusable; it is no provider failure.
  private async readApiKey(connectionId: string): Promise<string | null> {
    const encrypted =
      await this.dependencies.connections.findSecretEncrypted(connectionId);
    if (encrypted === null) return null;
    try {
      return this.dependencies.cipher.decrypt(connectionId, encrypted);
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
      return null;
    }
  }
}
