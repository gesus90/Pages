import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { ChatError } from "@/backend/error/ChatErrors";
import { modelConsumerRefusal } from "@/definition/AgentModelConsumers";
import { catalogModelChoice } from "@/definition/AgentModelChoice";

import { resolveAgentAssignment } from "../agents/AgentAssignmentResolution";
import { connectionModels } from "../agents/AgentConnectionModels";
import { requireAgentAdministrator } from "../agents/AgentServiceAccess";
import { picaAcpRunner } from "./acp/PicaAcpRunners";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { ChatDecisionSettingsRepository } from "@/backend/database/repositories/chat/ChatDecisionSettingsRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentModelSelection } from "@/definition/AgentModelSelection";
import type {
  ChatDecisionAdministration,
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
 * choice shows every accessible model; the `pica` rule of
 * `modelConsumerRefusal` disables incompatible entries. It has no tools and runs no action,
 * because its session is read-only and gets no MCP server. A saved model the
 * selection refuses keeps its value and counts as unavailable.
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
    const [settings, models] = await Promise.all([
      this.dependencies.settings.read(),
      this.listedModels(await this.viewer(actor)),
    ]);
    return {
      settings,
      status: this.status(settings.selection, models),
      models,
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
      if (model === null || modelConsumerRefusal("pica", model) !== null)
        throw new AgentError("provider_model_not_found");
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
      const catalog = await this.dependencies.connections
        .catalogs()
        .find(assignment.connection.id);
      const model = catalog.models.find(
        (entry) => entry.id === assignment.model,
      );
      if (
        !model ||
        modelConsumerRefusal(
          "pica",
          catalogModelChoice(assignment.connection, model),
        ) !== null
      )
        return null;
      // The runner must accept the choice; its own run mode stays out.
      picaAcpRunner(assignment).runOptions(assignment);
      return assignment;
    } catch (error: unknown) {
      if (error instanceof AgentExecutionError || error instanceof ChatError)
        return null;
      throw error;
    }
  }

  private async listedModels(
    viewer: AgentViewer,
  ): Promise<readonly PageAgentModel[]> {
    return connectionModels(this.dependencies.connections, viewer);
  }

  private status(
    selection: AgentModelSelection | null,
    models: readonly PageAgentModel[],
  ): ChatDecisionStatus {
    if (selection === null) return "noModel";
    const model = findListed(models, selection);
    return model === null || modelConsumerRefusal("pica", model) !== null
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
