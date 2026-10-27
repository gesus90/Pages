import { createHash } from "node:crypto";

import { scanAgentPlaceholders } from "@/definition/AgentParameters";
import { AgentAssetError } from "@/backend/error/AgentAssetError";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { MAX_RUNNER_PROMPT_CHARACTERS } from "@/definition/RunnerExecution";

import { assetFailure } from "./AgentPlanStepFailure";
import { remoteAssetFile } from "./AgentAssetRemoteFile";
import { bindAgentParameters } from "./AgentParameterBinding";
import { planBindings } from "./AgentPlanBindings";
import {
  requireAssetReferences,
  ticketAssetReferences,
} from "./AgentTicketAssetReferences";
import { MAX_TICKET_ASSET_BYTES } from "./AgentTicketAssetService";

import type { AgentTicketAssetContent } from "@/definition/AgentTicketParameter";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserService } from "@/backend/service/UserService";
import type { AgentPlan, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentParameterValue } from "@/definition/AgentParameters";
import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type {
  PlanRemoteFile,
  PlanRemoteResource,
} from "@/definition/AgentPlanRemoteAccess";
import type {
  AgentTicketAsset,
  ResolvedAgentTicket,
} from "@/definition/AgentTicketParameter";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { AgentTicketParameterService } from "./AgentTicketParameterService";
import type { AgentTicketAssetService } from "./AgentTicketAssetService";
import type { AgentContentAccess } from "./AgentContentAccess";
import type { AgentPlanRemoteTargets } from "./AgentPlanRemoteTargets";
import type { AgentPlanTaskSnapshot } from "./AgentPlanBindings";
import type { AgentReferenceResolvers } from "./AgentParameterBinding";

type WikiReference = Awaited<ReturnType<AgentContentAccess["wiki"]>>;

/** Private pinned reference basis; binary contents are always read again at transmission. */
export interface RemotePlanParameters {
  readonly values: Readonly<Record<string, AgentParameterValue | null>>;
  readonly tickets: Readonly<Record<string, ResolvedAgentTicket>>;
  readonly wiki: Readonly<Record<string, WikiReference>>;
  readonly workspaces: Readonly<Record<string, AgentPlanRemoteTarget>>;
  readonly resources: readonly PlanRemoteResource[];
  readonly assets: readonly RemoteParameterAsset[];
}

/** An authorized file identity, including the owning parameter resource. */
export interface RemoteParameterAsset {
  readonly owner: { readonly type: "ticket" | "wiki"; readonly id: string };
  readonly reference: AgentTicketAsset;
  readonly file: PlanRemoteFile;
}

interface RemoteParameterCollection {
  readonly tickets: Record<string, ResolvedAgentTicket>;
  readonly wiki: Record<string, WikiReference>;
  readonly workspaces: Record<string, AgentPlanRemoteTarget>;
  readonly resources: PlanRemoteResource[];
  readonly assets: RemoteParameterAsset[];
}

interface RemoteParameterContext {
  readonly parameter: string;
  readonly projectId: string;
  readonly target: AgentPlanRemoteTarget;
  readonly shouldTransfer: boolean;
}

interface RemoteParameterDependencies {
  readonly tickets: AgentTicketParameterService;
  readonly content: AgentContentAccess;
  readonly assets: AgentTicketAssetService;
  readonly authorization: AuthorizationRepository;
  readonly users: Pick<UserService, "getById">;
  readonly targets: AgentPlanRemoteTargets;
}

/** Resolves remote references with the local content/file policies and no local workspace paths. */
export class AgentPlanRemoteParameters {
  private readonly dependencies: RemoteParameterDependencies;

  public constructor(dependencies: RemoteParameterDependencies) {
    this.dependencies = dependencies;
  }

  /** Pins every parameter and checks file delivery before a run can be admitted. */
  public async prepare(
    userId: string,
    input: {
      readonly plan: AgentPlan;
      readonly step: AgentPlanStep;
      readonly tasks: readonly AgentPlanTaskSnapshot[];
      readonly target: AgentPlanRemoteTarget;
    },
  ): Promise<RemotePlanParameters> {
    const { plan, step, tasks, target } = input;
    const template = step.configuration?.template;
    if (!template) throw new AgentError("configuration_invalid");
    const tickets: Record<string, ResolvedAgentTicket> = {};
    const wiki: Record<string, WikiReference> = {};
    const workspaces: Record<string, AgentPlanRemoteTarget> = {};
    const values: Record<string, AgentParameterValue | null> = {};
    const resources: PlanRemoteResource[] = [];
    const assets: RemoteParameterAsset[] = [];
    const collection = { tickets, wiki, workspaces, resources, assets };
    const placeholders = scanAgentPlaceholders(
      `${template.markdown}\n\n${step.instruction}`,
    ).placeholders;
    const issues: AgentPlanIssue[] = [];
    for (const parameter of template.parameters) {
      try {
        const binding = step.bindings[parameter.name];
        const bound = binding
          ? planBindings(
              plan,
              { bindings: { [parameter.name]: binding } },
              tasks,
              [parameter],
            )[parameter.name]
          : parameter.defaultValue;
        values[parameter.name] = bound;
        await this.collectReference(
          userId,
          bound,
          {
            parameter: parameter.name,
            projectId: plan.projectId,
            target,
            shouldTransfer: placeholders.some(
              (placeholder) =>
                placeholder.name === parameter.name &&
                ["text", "assets", "markdown"].includes(placeholder.property),
            ),
          },
          collection,
        );
        requireAssetBudget(assets);
      } catch (error: unknown) {
        issues.push(
          ...remoteParameterError(
            step.id,
            parameter.name,
            parameter.type,
            error,
          ).issues,
        );
      }
    }
    if (issues.length) throw new AgentPlanValidationError(issues);
    return { values, tickets, wiki, workspaces, resources, assets };
  }

  /** Rechecks resource access without replacing the pinned text or version. */
  public async authorize(
    userId: string,
    prepared: RemotePlanParameters,
    context: {
      readonly projectId: string;
      readonly target: AgentPlanRemoteTarget;
    },
  ): Promise<void> {
    const choices = await this.dependencies.targets.list(
      userId,
      context.projectId,
    );
    for (const workspace of [
      context.target,
      ...Object.values(prepared.workspaces),
    ]) {
      const current = choices.find(
        (entry) => entry.workspaceId === workspace.workspaceId,
      );
      if (
        !current ||
        planContentDigest(current) !== planContentDigest(workspace)
      )
        throw new AgentError("plan_context_changed");
    }
    for (const ticket of Object.values(prepared.tickets))
      await this.dependencies.tickets.resolve(userId, ticket.id);
    for (const id of Object.keys(prepared.wiki)) await this.wiki(userId, id);
  }

  /** Reauthorizes owner, reference and bytes for every bounded file chunk sent to the runner. */
  public async readAsset(
    userId: string,
    asset: RemoteParameterAsset,
    prepared: RemotePlanParameters,
  ): Promise<Buffer> {
    return (await this.readAssetContent(userId, asset, prepared)).bytes;
  }

  /** Resolves transient model content only after the same source, owner and original-digest checks. */
  public async readAssetContent(
    userId: string,
    asset: RemoteParameterAsset,
    prepared: RemotePlanParameters,
  ): Promise<{
    readonly bytes: Buffer;
    readonly content: AgentTicketAssetContent["content"];
  }> {
    const expected =
      asset.owner.type === "ticket"
        ? prepared.tickets[asset.owner.id]?.assets
        : ticketAssetReferences(prepared.wiki[asset.owner.id]?.markdown ?? "");
    if (!expected) throw new AgentError("parameter_ticket_changed");
    const references =
      asset.owner.type === "ticket"
        ? (await this.dependencies.tickets.resolve(userId, asset.owner.id))
            .assets
        : ticketAssetReferences(
            (await this.wiki(userId, asset.owner.id)).markdown,
          );
    requireAssetReferences(expected, references);
    if (
      !references.some(
        (entry) =>
          entry.id === asset.reference.id &&
          entry.source === asset.reference.source,
      )
    )
      throw new AgentError("parameter_ticket_changed");
    const file = await this.assetContents(userId, asset.reference);
    if (
      fileDigest(file.bytes) !== asset.file.digest ||
      file.bytes.length !== asset.file.size
    )
      throw new AgentAssetError(
        "parameter_ticket_changed",
        asset.reference,
        asset.file.name,
      );
    return { bytes: file.bytes, content: file.content };
  }

  private async collectReference(
    userId: string,
    bound: AgentParameterValue | null,
    context: RemoteParameterContext,
    collection: RemoteParameterCollection,
  ): Promise<void> {
    const { parameter, projectId, target } = context;
    if (bound?.type === "ticket") {
      const ticket = await this.dependencies.tickets.resolve(
        userId,
        bound.ticketId,
      );
      collection.tickets[ticket.id] = ticket;
      collection.resources.push({
        parameter,
        type: "ticket",
        id: ticket.id,
        name: ticket.key,
        version: planContentDigest(ticket.version),
      });
      await this.collectAssets(
        userId,
        { type: "ticket", id: ticket.id },
        context.shouldTransfer ? ticket.assets : [],
        { parameter, collection },
      );
    }
    if (bound?.type === "wiki") {
      const page = await this.wiki(userId, bound.pageId);
      collection.wiki[bound.pageId] = page;
      collection.resources.push({
        parameter,
        type: "wiki",
        id: bound.pageId,
        name: page.link,
        version: page.version,
      });
      await this.collectAssets(
        userId,
        { type: "wiki", id: bound.pageId },
        context.shouldTransfer ? ticketAssetReferences(page.markdown) : [],
        { parameter, collection },
      );
    }
    if (bound?.type === "workspace") {
      const workspace = (
        await this.dependencies.targets.list(userId, projectId)
      ).find((entry) => entry.workspaceId === bound.workspaceId);
      if (!workspace || workspace.connectionId !== target.connectionId)
        throw new AgentError("parameter_reference_unavailable");
      collection.workspaces[bound.workspaceId] = workspace;
      collection.resources.push({
        parameter,
        type: "workspace",
        id: workspace.workspaceId,
        name: workspace.workspaceName,
        version: String(workspace.workspaceRevision),
      });
    }
  }

  private async collectAssets(
    userId: string,
    owner: RemoteParameterAsset["owner"],
    references: readonly AgentTicketAsset[],
    context: {
      readonly parameter: string;
      readonly collection: RemoteParameterCollection;
    },
  ): Promise<void> {
    for (const reference of references) {
      context.collection.assets.push(
        await this.pinAsset(userId, context.parameter, owner, reference),
      );
      requireAssetBudget(context.collection.assets);
    }
  }

  private async wiki(userId: string, id: string): Promise<WikiReference> {
    const actor = (
      await this.dependencies.authorization.snapshot()
    ).accounts.find((entry) => entry.userId === userId);
    if (!actor?.isActive)
      throw new AgentError("parameter_reference_unavailable");
    return this.dependencies.content.wiki(actor, id);
  }

  private async pinAsset(
    userId: string,
    parameter: string,
    owner: RemoteParameterAsset["owner"],
    reference: AgentTicketAsset,
  ): Promise<RemoteParameterAsset> {
    const file = await this.assetContents(userId, reference);
    return {
      owner,
      reference,
      file: remoteAssetFile(parameter, reference, {
        fileName: file.name,
        original: file.original,
        content: file.content,
      }),
    };
  }

  private async assetContents(
    userId: string,
    reference: AgentTicketAsset,
  ): Promise<{
    readonly bytes: Buffer;
    readonly name: string;
    readonly type: string;
    readonly content: AgentTicketAssetContent["content"];
    readonly original: NonNullable<AgentTicketAssetContent["original"]>;
  }> {
    const actor = await this.dependencies.users.getById(userId);
    if (!actor?.isActive) throw new AgentError("parameter_asset_unavailable");
    const file = await this.dependencies.assets.read(actor, reference);
    return {
      name: file.fileName,
      type: file.original.mimeType,
      bytes: file.bytes,
      content: file.content,
      original: file.original,
    };
  }
}

function fileDigest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Returns the same safe node/parameter cause for editor checks and dispatch failures. */
export function remoteParameterError(
  nodeId: string,
  port: string,
  type: string,
  error: unknown,
): AgentPlanValidationError {
  let reason: AgentPlanIssue["reason"] = "remoteParameter";
  if (type === "ticket") reason = "remoteTicketUnavailable";
  if (type === "wiki") reason = "remoteWikiUnavailable";
  if (type === "workspace") reason = "remoteWorkspaceParameter";
  if (error instanceof AgentError) {
    if (error.code === "parameter_assets_too_large")
      reason = "remoteAssetsTooLarge";
    else if (
      error.code === "parameter_asset_type_unsupported" ||
      error.code === "parameter_asset_reference_unsupported"
    )
      reason = "remoteAssetType";
    else if (
      error.code === "parameter_asset_unavailable" ||
      error.code === "parameter_ticket_changed"
    )
      reason = "remoteAssetUnavailable";
  }
  return new AgentPlanValidationError([
    {
      nodeId,
      port,
      reason,
      ...(assetFailure(error).assetFailure
        ? { asset: assetFailure(error).assetFailure }
        : {}),
    },
  ]);
}

/** Binds frozen remote content through the existing non-recursive parameter binder. */
export function remoteParameterResolvers(
  prepared: RemotePlanParameters,
): AgentReferenceResolvers {
  return {
    ticket: (id) => {
      const ticket = prepared.tickets[id];
      return ticket
        ? Promise.resolve(ticket)
        : Promise.reject(new AgentError("parameter_ticket_unavailable"));
    },
    wiki: (id) => {
      const page = prepared.wiki[id];
      return page
        ? Promise.resolve(page)
        : Promise.reject(new AgentError("parameter_reference_unavailable"));
    },
    workspace: (id) => {
      const workspace = prepared.workspaces[id];
      return workspace
        ? Promise.resolve({ path: workspace.path })
        : Promise.reject(new AgentError("parameter_reference_unavailable"));
    },
  };
}

/** Checks the complete template with the same typed values later used at dispatch. */
export async function validateRemoteParameterPrompt(
  step: AgentPlanStep,
  prepared: RemotePlanParameters,
  markdown: string,
): Promise<void> {
  const template = step.configuration?.template;
  if (!template) throw new AgentError("configuration_invalid");
  try {
    const bound = await bindAgentParameters(
      { ...template, markdown },
      prepared.values,
      remoteParameterResolvers(prepared),
    );
    requireRemotePromptSize(
      step,
      bound.markdown + remoteWorkspaceContext(prepared),
    );
  } catch (error: unknown) {
    if (error instanceof AgentPlanValidationError) throw error;
    const port =
      template.parameters.find(
        (parameter) => parameter.isRequired && !prepared.values[parameter.name],
      )?.name ??
      template.parameters[0]?.name ??
      "parameters";
    throw remoteParameterError(step.id, port, "", error);
  }
}

/** Adds only the pinned names and paths of remote workspace parameters. */
export function remoteWorkspaceContext(
  prepared: RemotePlanParameters | undefined,
): string {
  if (!prepared?.resources.some((resource) => resource.type === "workspace"))
    return "";
  return `\n\nPages remote workspaces:\n${Object.values(prepared.workspaces)
    .map((workspace) => `${workspace.workspaceName}: ${workspace.path}`)
    .join("\n")}`;
}

/** Refuses an oversized complete prompt with its node and contributing parameter names, without truncating it. */
export function requireRemotePromptSize(
  step: AgentPlanStep,
  prompt: string,
): void {
  if (prompt.length <= MAX_RUNNER_PROMPT_CHARACTERS) return;
  const template = step.configuration?.template;
  const names = scanAgentPlaceholders(
    `${template?.markdown ?? ""}\n\n${step.instruction}`,
  ).placeholders.map((placeholder) => placeholder.name);
  const ports =
    template?.parameters
      .filter((parameter) => names.includes(parameter.name))
      .map((parameter) => parameter.name) ?? [];
  throw new AgentPlanValidationError(
    (ports.length ? ports : [null]).map((port) => ({
      nodeId: step.id,
      port,
      reason: "remotePromptTooLarge",
    })),
  );
}

function requireAssetBudget(assets: readonly RemoteParameterAsset[]): void {
  const originalBytes = assets.reduce(
    (total, asset) => total + asset.file.size,
    0,
  );
  const manifestBytes =
    Buffer.byteLength(JSON.stringify(assets.map((asset) => asset.file))) +
    assets.reduce((total, asset) => total + (asset.file.modelSize ?? 0), 0);
  if (
    assets.length <= 64 &&
    originalBytes <= MAX_TICKET_ASSET_BYTES &&
    manifestBytes <= 1024 * 1024
  )
    return;
  const last = assets.at(-1);
  if (last)
    throw new AgentAssetError(
      "parameter_assets_too_large",
      last.reference,
      last.file.name,
    );
  throw new AgentError("parameter_assets_too_large");
}
