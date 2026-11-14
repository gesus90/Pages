import { AgentError } from "@/backend/error/AgentErrors";

import { bindAgentParameters } from "./AgentParameterBinding";

import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { ResolvedAgentWorkspace } from "@/definition/AgentWorkspace";
import type { AgentProfileService } from "./AgentProfileService";
import type { AgentContentAccess } from "./AgentContentAccess";
import type { AgentWorkspaceService } from "./AgentWorkspaceService";
import type { BoundAgentParameters } from "./AgentParameterBinding";
import type { AgentPlanTemplate } from "./AgentPlanSnapshot";
import type { AgentPlanAssetFile } from "@/definition/AgentPlanAsset";
import type { PlanAssetService } from "./assets/PlanAssetService";
import type {
  AgentTicketInput,
  AgentTicketAssetContent,
  AgentTicketAsset,
} from "@/definition/AgentTicketParameter";
import type {
  AgentTicketParameterService,
  AgentTicketParameterText,
} from "./AgentTicketParameterService";

/** The workspace supplies project context; explicit directory parameters alone supply a CLI cwd. */
export interface AgentParameterSelection {
  readonly agentId: string;
  readonly personalAgentId: string | null;
  readonly workspaceId: string;
  readonly configuration?: AgentPlanConfiguration;
  /** The first attempt's ticket copies, reused during authorization and retries. */
  readonly ticketInputs?: readonly AgentTicketInput[];
}

/** Server preparation for A10.4, with no process start, provider request or credentials. */
export interface PreparedAgentParameters {
  readonly parameters: BoundAgentParameters;
  readonly workspace: ResolvedAgentWorkspace;
  readonly directory: ResolvedAgentWorkspace | null;
  readonly references: readonly ResolvedAgentWorkspace[];
  readonly tickets?: Readonly<Record<string, AgentTicketParameterText>>;
  /** The plan assets the parameters name, described after checking the executor's rights. */
  readonly assets?: Readonly<Record<string, AgentPlanAssetFile>>;
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
  readonly profiles: Pick<AgentProfileService, "resolveDefinition">;
  readonly workspaces: Pick<AgentWorkspaceService, "resolve">;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly content: Pick<AgentContentAccess, "wiki">;
  readonly tickets?: Pick<AgentTicketParameterService, "resolve"> &
    Partial<
      Pick<
        AgentTicketParameterService,
        "readAssets" | "requireAssets" | "pinAssets"
      >
    >;
  /** The files of asset nodes (PAGE-268); without them an asset parameter cannot be bound. */
  readonly planAssets?: Pick<PlanAssetService, "describe">;
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

  /** Reauthorizes ticket-derived output as well as current parameter bindings. */
  public async requireTicket(userId: string, ticketId: string): Promise<void> {
    if (!this.dependencies.tickets)
      throw new AgentError("parameter_ticket_unavailable");
    await this.dependencies.tickets.resolve(userId, ticketId);
  }

  /** Loads files only at the runner boundary; a copied reference never grants access. */
  public async readTicketAssets(
    userId: string,
    inputs: readonly AgentTicketInput[],
  ): Promise<readonly AgentTicketAssetContent[]> {
    if (inputs.length === 0) return [];
    const tickets = this.dependencies.tickets;
    if (!tickets?.readAssets)
      throw new AgentError("parameter_asset_transfer_unsupported");
    return tickets.readAssets(userId, inputs);
  }

  /** Reauthorizes the original asset references before disclosing a saved result. */
  public async requireTicketAssets(
    userId: string,
    assets: readonly AgentTicketAsset[],
  ): Promise<void> {
    if (assets.length === 0) return;
    const tickets = this.dependencies.tickets;
    if (!tickets?.requireAssets)
      throw new AgentError("parameter_asset_transfer_unsupported");
    await tickets.requireAssets(userId, assets);
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
        configuration: selection.configuration,
      },
    );
    const configuration = template ?? resolved.profile.configuration;
    if (!configuration) throw new AgentError("configuration_invalid");
    const references = new Map<string, ResolvedAgentWorkspace>();
    const tickets: Record<string, AgentTicketParameterText> = {};
    const assets: Record<string, AgentPlanAssetFile> = {};
    const wiki: Record<
      string,
      {
        readonly markdown: string;
        readonly link: string;
        readonly version: string;
      }
    > = {};
    const parameters = await bindAgentParameters(configuration, bindings, {
      allowIncomplete: template !== undefined,
      ticket: async (id) => {
        if (!this.dependencies.tickets)
          throw new AgentError("parameter_ticket_unavailable");
        const ticket = await this.dependencies.tickets.resolve(userId, id);
        tickets[id] = ticket;
        return ticket;
      },
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
      asset: async (id) => {
        const file = await this.describeAsset(userId, id, workspace.projectId);
        assets[id] = file;
        return file;
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
      parameters: {
        ...parameters,
        assetInputs: await this.pinInputs(
          userId,
          parameters.assetInputs,
          selection.ticketInputs,
        ),
      },
      workspace,
      directory,
      references: [...references.values()],
      tickets,
      assets,
      wiki,
    };
  }

  /**
   * Describes a plan asset of the plan's project that the executor may read.
   *
   * @remarks
   * Only the description: the bytes are read at the handover, so a damaged
   * stack entry fails its own turn and not the start of the run.
   */
  private async describeAsset(
    userId: string,
    assetId: string,
    projectId: string,
  ): Promise<AgentPlanAssetFile> {
    if (!this.dependencies.planAssets)
      throw new AgentError("parameter_asset_transfer_unsupported");
    const record = await this.dependencies.planAssets.describe(userId, assetId);
    if (record.projectId !== projectId)
      throw new AgentError("plan_asset_missing");
    return {
      assetId: record.assetId,
      fileName: record.fileName,
      mediaType: record.mediaType,
      kind: record.kind,
      size: record.size,
      digest: record.digest,
    };
  }
  private async pinInputs(
    userId: string,
    inputs: readonly AgentTicketInput[],
    previous: readonly AgentTicketInput[] = [],
  ): Promise<readonly AgentTicketInput[]> {
    inputs = inputs.map(
      (input) =>
        previous.find(
          (pinned) =>
            pinned.snapshots !== undefined &&
            pinned.parameter === input.parameter &&
            pinned.ticket.id === input.ticket.id &&
            pinned.owner === input.owner,
        ) ?? input,
    );
    const ticketService = this.dependencies.tickets;
    if (ticketService?.pinAssets) {
      const fresh = inputs.filter((input) => input.snapshots === undefined);
      const pinned = await ticketService.pinAssets(userId, fresh);
      inputs = inputs.map(
        (input) =>
          pinned.find((entry) => entry.parameter === input.parameter) ?? input,
      );
    }
    // A plan asset carries its pinned digest already; its bytes are read at the handover.
    const reading = inputs.filter(
      (input) => input.owner !== "asset" && input.snapshots === undefined,
    );
    if (!reading.some((input) => input.ticket.assets.length > 0)) return inputs;
    const contents = await this.readTicketAssets(userId, reading);
    return inputs.map((input) =>
      input.owner === "asset" || input.snapshots !== undefined
        ? input
        : {
            ...input,
            originals: Object.fromEntries(
              contents
                .filter((file) => file.parameter === input.parameter)
                .map((file) => {
                  if (!file.original)
                    throw new AgentError(
                      "parameter_asset_transfer_unsupported",
                    );
                  return [
                    `${file.asset.source}:${file.asset.id}`,
                    file.original.digest,
                  ];
                }),
            ),
          },
    );
  }
}
