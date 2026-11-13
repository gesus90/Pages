import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { ChatError } from "@/backend/error/ChatErrors";
import { isApiProvider } from "@/definition/AgentConnection";
import { catalogModelChoice } from "@/definition/AgentModelChoice";
import { consumerModels } from "@/definition/AgentModelConsumers";

import { resolveAgentAssignment } from "../agents/AgentAssignmentResolution";
import { canUseAgentConnection } from "../agents/AgentConnectionAccess";
import { connectionModels } from "../agents/AgentConnectionModels";
import { requireAgentAdministrator } from "../agents/AgentServiceAccess";
import { picaAcpRunner } from "./acp/PicaAcpRunners";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { ChatDecisionSettingsRepository } from "@/backend/database/repositories/chat/ChatDecisionSettingsRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentModelSelection } from "@/definition/AgentModelSelection";
import type {
  ChatDecisionAdministration,
  ChatDecisionEmptyReason,
  ChatDecisionStatus,
} from "@/definition/ConversationDecision";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { ResolvedAgentAssignment } from "../agents/AgentAssignmentResolution";

/** What the setting is read and checked with. */
export interface ChatDecisionSettingsDependencies {
  readonly settings: ChatDecisionSettingsRepository;
  readonly connections: AgentConnectionRepository;
  readonly groups: Pick<UserGroupRepository, "findIdsByMember">;
}

/** A submitted change of the decision model. */
export interface ChatDecisionSettingsInput {
  readonly selection: AgentModelSelection | null;
  readonly revision: number;
}

function findListed(
  models: readonly PageAgentModel[],
  selection: AgentModelSelection | null,
): PageAgentModel | null {
  if (selection === null) return null;
  return (
    models.find(
      (entry) =>
        entry.connectionId === selection.connectionId &&
        entry.model === selection.model,
    ) ?? null
  );
}

/**
 * The decision model of the instance (PAGE-317): the one model that chooses
 * which agent answers a message of a group chat.
 *
 * @remarks
 * It is one setting of the instance next to the speech recognition. Only an
 * administrator in the active admin mode reads the form and saves. The model
 * comes from the text models the shared catalog releases for decisions (the rule
 * `decision` of `modelConsumerRefusal`); it has no tools and runs no action,
 * because its session is read-only and gets no MCP server. A saved model the
 * selection no longer lists keeps its value and counts as unavailable.
 */
export class ChatDecisionSettingsService {
  private readonly dependencies: ChatDecisionSettingsDependencies;
  private readonly writes = new SerialQueue();

  public constructor(dependencies: ChatDecisionSettingsDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Supplies the settings card.
   *
   * @param actor - The administrator in the admin mode.
   * @returns The setting, its state and the models that can be chosen.
   */
  public async administration(
    actor: AccountAccess,
  ): Promise<ChatDecisionAdministration> {
    requireAgentAdministrator(actor);
    const viewer = await this.viewer(actor);
    const [settings, models] = await Promise.all([
      this.dependencies.settings.read(),
      this.listedModels(viewer),
    ]);
    return {
      settings,
      status: this.status(settings.selection, models),
      models,
      emptyReason: await this.emptyReason(models, viewer),
    };
  }

  /**
   * Saves the decision model.
   *
   * @param actor - The administrator in the admin mode.
   * @param input - The choice with the revision it was read at; `null` removes it.
   * @throws {AgentError} `provider_model_not_found` for a model the selection
   * does not list, `profile_invalid` for a reasoning level it does not offer,
   * `profile_conflict` after a concurrent change.
   */
  public async save(
    actor: AccountAccess,
    input: ChatDecisionSettingsInput,
  ): Promise<void> {
    requireAgentAdministrator(actor);
    const { selection } = input;
    if (selection !== null) {
      const model = findListed(
        await this.listedModels(await this.viewer(actor)),
        selection,
      );
      if (model === null) throw new AgentError("provider_model_not_found");
      if (
        selection.reasoningEffort !== null &&
        !model.reasoningEfforts.includes(selection.reasoningEffort)
      )
        throw new AgentError("profile_invalid");
    }
    await this.writes.run(() =>
      this.dependencies.settings.save({ selection, revision: input.revision }),
    );
  }

  /**
   * The model that decides now, for every group of the instance.
   *
   * @returns The resolved model, or `null` while none is chosen or the
   * chosen one cannot run; the decision then falls back.
   */
  public async resolve(): Promise<ResolvedAgentAssignment | null> {
    const { selection } = await this.dependencies.settings.read();
    if (selection === null) return null;
    try {
      const assignment = await resolveAgentAssignment(
        this.dependencies.connections,
        selection,
      );
      // The runner must accept the choice; its own run mode stays out.
      if (!isApiProvider(assignment.connection.provider))
        picaAcpRunner(assignment).runOptions(assignment);
      const catalog = await this.dependencies.connections
        .catalogs()
        .find(assignment.connection.id);
      const model = catalog.models.find(
        (entry) => entry.id === assignment.model,
      );
      if (
        model &&
        consumerModels("decision", [
          catalogModelChoice(assignment.connection, model),
        ]).length === 0
      )
        return null;
      return assignment;
    } catch (error: unknown) {
      if (error instanceof AgentExecutionError || error instanceof ChatError)
        return null;
      throw error;
    }
  }

  /** Public health state without model names, connection details or credentials. */
  public async currentStatus(): Promise<ChatDecisionStatus> {
    const { selection } = await this.dependencies.settings.read();
    if (selection === null) return "noModel";
    return (await this.resolve()) === null ? "modelUnavailable" : "ready";
  }

  private async emptyReason(
    models: readonly PageAgentModel[],
    viewer: AgentViewer,
  ): Promise<ChatDecisionEmptyReason | null> {
    if (models.length > 0) return null;
    const connections = this.dependencies.connections;
    const active = (await connections.list()).filter((entry) => entry.isActive);
    if (active.length === 0) return "noConnections";
    const admitted = await Promise.all(
      active.map(async (entry) =>
        (await canUseAgentConnection(connections, viewer, entry.id))
          ? entry
          : null,
      ),
    );
    const visible = admitted.filter((entry) => entry !== null);
    if (visible.length === 0) return "noVisibleConnections";
    const verified = await Promise.all(
      visible.map(async (entry) =>
        (await this.isVerified(entry)) ? entry : null,
      ),
    );
    const usable = verified.filter((entry) => entry !== null);
    if (usable.length === 0) return "connectionUnavailable";
    const catalogs = await Promise.all(
      usable.map(async (entry) => {
        const catalog = await connections.catalogs().find(entry.id);
        return (
          catalog.models.length > 0 ||
          (entry.provider === "zai" && entry.testModel !== null)
        );
      }),
    );
    return catalogs.some(Boolean) ? "noTextModels" : "emptyCatalog";
  }

  private async isVerified(
    connection: AgentConnectionRecord,
  ): Promise<boolean> {
    if (!isApiProvider(connection.provider))
      return connection.cliLoggedInAt !== null;
    if (!connection.hasApiKey) return false;
    return (
      (await this.dependencies.connections.checks().find(connection.id, "auth"))
        ?.status === "passed"
    );
  }

  private async listedModels(
    viewer: AgentViewer,
  ): Promise<readonly PageAgentModel[]> {
    return consumerModels(
      "decision",
      await connectionModels(this.dependencies.connections, viewer),
    );
  }

  private status(
    selection: AgentModelSelection | null,
    models: readonly PageAgentModel[],
  ): ChatDecisionStatus {
    if (selection === null) return "noModel";
    return findListed(models, selection) === null
      ? "modelUnavailable"
      : "ready";
  }

  private async viewer(actor: AccountAccess): Promise<AgentViewer> {
    return {
      actor,
      groupIds: await this.dependencies.groups.findIdsByMember(actor.userId),
    };
  }
}
