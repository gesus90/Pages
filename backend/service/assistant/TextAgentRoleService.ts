import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { requireAgentAdministrator } from "@/backend/service/agents/AgentServiceAccess";
import { resolveAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type { TextAssistantSettingsRepository } from "@/backend/database/repositories/assistant/TextAssistantSettingsRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type { TextAssistantSettings } from "@/definition/TextAssistant";

/** A fresh, immutable configuration for exactly one request. */
export type ResolvedTextAgent = ResolvedAgentAssignment;

function requireRetention(retentionDays: number): void {
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > 365
  )
    throw new TextAssistantError("invalidInput");
}

/** Enforces the function role independently of connection test defaults. */
export class TextAgentRoleService {
  private readonly settings: TextAssistantSettingsRepository;
  private readonly connections: AgentConnectionRepository;
  private readonly operations: AgentOperationRegistry;

  public constructor(
    settings: TextAssistantSettingsRepository,
    connections: AgentConnectionRepository,
    operations: AgentOperationRegistry = new AgentOperationRegistry(),
  ) {
    this.settings = settings;
    this.connections = connections;
    this.operations = operations;
  }

  /** Role and retention configuration is available only to active administrators. */
  public async read(actor: AccountAccess): Promise<TextAssistantSettings> {
    requireAgentAdministrator(actor);
    return this.settings.read();
  }

  /** Validates against the actual stored catalog, with no model test or fallback. */
  public async save(
    actor: AccountAccess,
    settings: TextAssistantSettings,
  ): Promise<void> {
    requireAgentAdministrator(actor);
    requireRetention(settings.retentionDays);
    const role = settings.role;
    if (role === null) return this.settings.save(settings);
    await this.operations.run(role.connectionId, "write", async () => {
      await resolveAgentAssignment(this.connections, role);
      await this.settings.save(settings);
    });
  }

  /** Retention changes do not replace a concurrently edited assignment. */
  public async saveRetention(
    actor: AccountAccess,
    retentionDays: number,
  ): Promise<void> {
    requireAgentAdministrator(actor);
    requireRetention(retentionDays);
    await this.settings.saveRetention(retentionDays);
  }

  /** New requests resolve and revalidate the saved assignment once. */
  public async resolve(): Promise<ResolvedTextAgent> {
    const { role } = await this.settings.read();
    if (role === null) throw new TextAssistantError("roleMissing");
    return resolveAgentAssignment(this.connections, role);
  }
}
