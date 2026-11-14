import { logCaughtError } from "@/backend/logging/Logger";
import { isOpenCodeLinkedProvider } from "@/definition/AgentConnection";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AccountAccess } from "@/definition/Authorization";

interface LinkDependencies {
  readonly connections: AgentConnectionRepository;
  readonly check: (actor: AccountAccess, id: string) => Promise<unknown>;
}

/** Preserves connection activation without sharing API credentials with OpenCode. */
export class OpenCodeProviderLinks {
  private readonly dependencies: LinkDependencies;

  public constructor(dependencies: LinkDependencies) {
    this.dependencies = dependencies;
  }

  /** Checks only the changed API connection; other catalogs remain independent. */
  public async afterKeyChange(actor: AccountAccess, id: string): Promise<void> {
    const connection = await this.dependencies.connections.find(id);
    if (!connection || !isOpenCodeLinkedProvider(connection.provider)) return;
    if (connection.isActive && connection.hasApiKey)
      await this.check(actor, id);
  }

  /** Activates OpenCode's free catalog without a key of another connection. */
  public async activate(actor: AccountAccess, id: string): Promise<void> {
    const connection = await this.dependencies.connections.find(id);
    if (connection?.provider !== "opencode" || !connection.isActive) return;
    await this.check(actor, id);
  }

  private async check(actor: AccountAccess, id: string): Promise<void> {
    await this.dependencies.check(actor, id).catch((error: unknown) => {
      logCaughtError("OpenCodeProviderLinks", error);
    });
  }
}
