import { DecisionModelError } from "@/backend/error/DecisionModelError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type {
  DecisionQuestion,
  OpenRouterDecisionsClient,
  OpenRouterDecisionsResponse,
} from "../conversation/OpenRouterDecisionsClient";

const COMPONENT = "DecisionModelCalls";

/** What a decision call reads the key with and sends it through. */
export interface DecisionModelCallsDependencies {
  /** Where the key of the OpenRouter connection is stored. */
  readonly connections: Pick<AgentConnectionRepository, "findSecretEncrypted">;
  readonly cipher: Pick<InstanceSecretCipher, "decrypt">;
  /** The decisions interface of OpenRouter; swapped for a stub in tests. */
  readonly client: Pick<OpenRouterDecisionsClient, "decide">;
}

/** One call of a decision model of a stored OpenRouter connection. */
export interface DecisionModelCall {
  readonly connectionId: string;
  readonly model: string;
  readonly state: string | Readonly<Record<string, unknown>>;
  readonly questions: Readonly<Record<string, DecisionQuestion>>;
  /** The longest wait in milliseconds; the client's default when absent. */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/**
 * Calls a decision model with the key of the connection it belongs to.
 * @remarks
 * The key is decrypted for the one call and handed to the client in memory;
 * it is never logged, stored elsewhere or returned. The group chats and the
 * model decisions of plans both call through here.
 */
export class DecisionModelCalls {
  private readonly dependencies: DecisionModelCallsDependencies;

  public constructor(dependencies: DecisionModelCallsDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Asks once.
   * @param call - The connection, the model, the state and the questions.
   * @returns What the model answered, with the cost of the call.
   * @throws {DecisionModelError} `decision_no_model` when the connection has
   * no usable key, and every code of {@link OpenRouterDecisionsClient.decide}.
   */
  public async decide(
    call: DecisionModelCall,
  ): Promise<OpenRouterDecisionsResponse> {
    const apiKey = await this.readApiKey(call.connectionId);
    if (apiKey === null) throw new DecisionModelError("decision_no_model");
    return this.dependencies.client.decide({
      apiKey,
      model: call.model,
      state: call.state,
      questions: call.questions,
      ...(call.timeoutMs === undefined ? {} : { timeoutMs: call.timeoutMs }),
      ...(call.signal === undefined ? {} : { signal: call.signal }),
    });
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
