import { openCodeCredentials } from "@/backend/agents/cli/OpenCodeCredentialStore";
import { AgentError } from "@/backend/error/AgentErrors";

import type { CliCredentialAccess } from "@/backend/agents/cli/CliContracts";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";

/** Supplies only the explicitly selected API connection to its native plan worker. */
export class OpenCodeAgentCredentials {
  private readonly connections: AgentConnectionRepository;
  private readonly cipher: InstanceSecretCipher;

  public constructor(
    connections: AgentConnectionRepository,
    cipher: InstanceSecretCipher,
  ) {
    this.connections = connections;
    this.cipher = cipher;
  }

  /** Rechecks the selected connection and decrypts its key only for this process start. */
  public async read(
    selected: AgentConnectionRecord,
  ): Promise<CliCredentialAccess> {
    const connection = await this.connections.find(selected.id);
    if (
      !connection ||
      !connection.isActive ||
      !connection.hasApiKey ||
      connection.provider !== selected.provider ||
      (connection.provider !== "openrouter" && connection.provider !== "zai")
    )
      throw new AgentError("plan_model_unavailable");
    const auth = await this.connections.checks().find(connection.id, "auth");
    if (auth?.status !== "passed") throw new AgentError("provider_auth_failed");
    const encrypted = await this.connections.findSecretEncrypted(connection.id);
    if (encrypted === null) throw new AgentError("secret_unavailable");
    return openCodeCredentials({
      modelProvider: connection.provider,
      apiKey: this.cipher.decrypt(connection.id, encrypted),
    });
  }
}
