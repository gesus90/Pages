import { AgentError } from "@/backend/error/AgentErrors";

import { bindAgentParameters } from "./AgentParameterBinding";

import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { ResolvedAgentWorkspace } from "@/definition/AgentWorkspace";
import type { AgentProfileService } from "./AgentProfileService";
import type { AgentContentAccess } from "./AgentContentAccess";
import type { AgentWorkspaceService } from "./AgentWorkspaceService";
import type { BoundAgentParameters } from "./AgentParameterBinding";
import type { AgentPlanTemplate } from "./AgentPlanSnapshot";

/** The workspace supplies project context; explicit directory parameters alone supply a CLI cwd. */
export interface AgentParameterSelection {
  readonly agentId: string;
  readonly personalAgentId: string | null;
  readonly workspaceId: string;
}

/** Server preparation for A10.4, with no process start, provider request or credentials. */
export interface PreparedAgentParameters {
  readonly parameters: BoundAgentParameters;
  readonly workspace: ResolvedAgentWorkspace;
  readonly directory: ResolvedAgentWorkspace | null;
  readonly references: readonly ResolvedAgentWorkspace[];
  readonly wiki: Readonly<
    Record<
      string,
      {
        readonly markdown: string;
        readonly link: string;
        readonly version: string;
      }
    >
  >;
}

interface ParameterDependencies {
  readonly profiles: AgentProfileService;
  readonly workspaces: AgentWorkspaceService;
  readonly authorization: AuthorizationRepository;
  readonly content: AgentContentAccess;
}

/** Connects the A10.2 binder to live authorized workspace and wiki resolvers. */
export class AgentParameterService {
  private readonly dependencies: ParameterDependencies;

  public constructor(dependencies: ParameterDependencies) {
    this.dependencies = dependencies;
  }

  /** Reauthorizes wiki references before disclosing a historical plan result derived from them. */
  public async requireWiki(userId: string, pageId: string): Promise<void> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = snapshot.accounts.find(
      (account) => account.userId === userId,
    );
    if (!actor?.isActive) throw new AgentError("agent_usage_denied");
    await this.dependencies.content.wiki(actor, pageId);
  }

  /** Resolves context, model access, resource grants and an explicit real working directory. */
  public async prepare(
    userId: string,
    selection: AgentParameterSelection,
    bindings: unknown,
    template?: AgentPlanTemplate,
  ): Promise<PreparedAgentParameters> {
    const workspace = await this.dependencies.workspaces.resolve(
      userId,
      selection.workspaceId,
    );
    const resolved = await this.dependencies.profiles.resolveDefinition(
      userId,
      {
        agentId: selection.agentId,
        personalAgentId: selection.personalAgentId,
        projectId: workspace.projectId,
      },
    );
    const configuration = template ?? resolved.profile.configuration;
    if (!configuration) throw new AgentError("configuration_invalid");
    const references = new Map<string, ResolvedAgentWorkspace>();
    const wiki: Record<
      string,
      {
        readonly markdown: string;
        readonly link: string;
        readonly version: string;
      }
    > = {};
    const parameters = await bindAgentParameters(configuration, bindings, {
      workspace: async (id) => {
        const reference = await this.dependencies.workspaces.resolve(
          userId,
          id,
          workspace.projectId,
        );
        references.set(id, reference);
        return reference;
      },
      wiki: async (id) => {
        const snapshot = await this.dependencies.authorization.snapshot();
        const actor = snapshot.accounts.find(
          (account) => account.userId === userId,
        );
        if (!actor?.isActive) throw new AgentError("agent_usage_denied");
        const page = await this.dependencies.content.wiki(actor, id);
        wiki[id] = page;
        return page;
      },
    });
    const directoryValue =
      configuration.directoryParameter === null
        ? null
        : parameters.values[configuration.directoryParameter];
    const directory =
      directoryValue?.type === "workspace"
        ? (references.get(directoryValue.workspaceId) ?? null)
        : null;
    return {
      parameters,
      workspace,
      directory,
      references: [...references.values()],
      wiki,
    };
  }
}
