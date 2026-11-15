import { logCaughtError } from "@/backend/logging/Logger";
import {
  linkedApiProviderOf,
  openCodeModelProvider,
} from "@/definition/AgentConnection";

import { findOpenCodeLinks } from "../agents/OpenCodeProviderLinks";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";

/** The providers whose documented generation interfaces Pages calls (PAGE-382, PAGE-384). */
export type GenerationProvider = "openrouter" | "google_ai_studio";

/** How Pages reaches the generation function of a model. */
export interface GenerationRoute {
  readonly provider: GenerationProvider;
  /** The model as the provider names it. */
  readonly model: string;
  /** The connection whose stored key the request uses. */
  readonly keyConnection: "own" | "linked";
}

/**
 * The route to the generation function of a model, from its connection alone.
 *
 * @remarks
 * OpenCode runs OpenRouter and Gemini models with the keys of the API
 * connections Pages links (`openrouter/…`, `google/…`); a key OpenCode keeps
 * for the connection itself is not reachable for Pages. A direct API
 * connection of OpenRouter or Google AI Studio uses its own key. Claude
 * Code, Codex and Antigravity offer no generation interface Pages could call.
 *
 * @param connection - The connection of the model.
 * @param model - The model as the connection names it.
 * @returns The route, or `null` when Pages has none.
 */
export function generationRoute(
  connection: Pick<AgentConnectionRecord, "provider" | "cliAccountLabel">,
  model: string,
): GenerationRoute | null {
  if (
    connection.provider === "openrouter" ||
    connection.provider === "google_ai_studio"
  )
    return { provider: connection.provider, model, keyConnection: "own" };
  if (connection.provider !== "opencode") return null;
  const modelProvider = openCodeModelProvider(model);
  const provider = linkedApiProviderOf(modelProvider);
  if (provider !== "openrouter" && provider !== "google_ai_studio") return null;
  // The connection's own key keeps precedence in OpenCode; Pages cannot use it.
  if (connection.cliAccountLabel === modelProvider) return null;
  return {
    provider,
    model: model.slice(modelProvider.length + 1),
    keyConnection: "linked",
  };
}

/**
 * Whether a model without a route has none because OpenCode keeps its own
 * key for the provider of the model.
 *
 * @param connection - The connection of the model.
 * @param model - The model as the connection names it.
 */
export function isOwnOpenCodeKey(
  connection: Pick<AgentConnectionRecord, "provider" | "cliAccountLabel">,
  model: string,
): boolean {
  return (
    connection.provider === "opencode" &&
    connection.cliAccountLabel === openCodeModelProvider(model)
  );
}

/** What the keys of a generation route use. */
export interface AgentProviderKeysDependencies {
  readonly connections: Pick<
    AgentConnectionRepository,
    "findSecretEncrypted" | "list" | "checks"
  >;
  readonly cipher: Pick<InstanceSecretCipher, "decrypt">;
}

/**
 * The stored keys of the connections a generation route uses (PAGE-382,
 * PAGE-384). The key is read on the server for the one request and never
 * reaches the agent.
 */
export class AgentProviderKeys {
  private readonly dependencies: AgentProviderKeysDependencies;
  private readonly component: string;

  /**
   * @param dependencies - The connections and the cipher of the stored keys.
   * @param component - The name failures are logged under.
   */
  public constructor(
    dependencies: AgentProviderKeysDependencies,
    component: string,
  ) {
    this.dependencies = dependencies;
    this.component = component;
  }

  /** Whether the route's connection holds a usable key. */
  public async hasKey(
    connection: AgentConnectionRecord,
    route: GenerationRoute,
  ): Promise<boolean> {
    if (route.keyConnection === "own") return connection.hasApiKey;
    const link = (await findOpenCodeLinks(this.dependencies.connections)).get(
      route.provider,
    );
    return link?.isVerified === true;
  }

  /** The stored key of the route's connection; `null` when it is missing or unreadable. */
  public async readKey(
    connection: AgentConnectionRecord,
    route: GenerationRoute,
  ): Promise<string | null> {
    let keyConnectionId = connection.id;
    if (route.keyConnection === "linked") {
      const link = (await findOpenCodeLinks(this.dependencies.connections)).get(
        route.provider,
      );
      if (!link?.isVerified) return null;
      keyConnectionId = link.connection.id;
    }
    const encrypted =
      await this.dependencies.connections.findSecretEncrypted(keyConnectionId);
    if (encrypted === null) return null;
    try {
      return this.dependencies.cipher.decrypt(keyConnectionId, encrypted);
    } catch (error: unknown) {
      logCaughtError(this.component, error);
      return null;
    }
  }
}
