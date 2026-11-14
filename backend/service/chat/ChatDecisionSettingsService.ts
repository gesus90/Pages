import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { isValidDecisionRules } from "@/definition/ConversationDecision";
import { isApiProvider } from "@/definition/AgentConnection";
import { canUseAgentConnection } from "../agents/AgentConnectionAccess";
import { requireAgentAdministrator } from "../agents/AgentServiceAccess";
import { findDecisionModel, listDecisionModels } from "./ChatDecisionModels";

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
  ConversationDecisionModelView,
  ConversationDecisionRules,
} from "@/definition/ConversationDecision";
import type { PageAgentModel } from "@/definition/PageAgent";

/** What the setting is read and checked with. */
export interface ChatDecisionSettingsDependencies {
  readonly settings: ChatDecisionSettingsRepository;
  readonly connections: AgentConnectionRepository;
  readonly groups: Pick<UserGroupRepository, "findIdsByMember">;
  /** Whether the development simulation offers its decision model. */
  readonly isSimulation: boolean;
}

/** A submitted change of the decision model and the default rules. */
export interface ChatDecisionSettingsInput {
  readonly selection: AgentModelSelection | null;
  readonly rules: ConversationDecisionRules;
  readonly revision: number;
}

/** The decision model that decides now: where it runs and which model it is. */
export interface ResolvedDecisionModel {
  readonly connectionId: string;
  readonly model: string;
}

function statusOf(
  selection: AgentModelSelection | null,
  models: readonly PageAgentModel[],
): ChatDecisionStatus {
  if (selection === null) return "noModel";
  return findDecisionModel(models, selection) === null
    ? "modelUnavailable"
    : "ready";
}

/**
 * The decision model of the instance (PAGE-317, PAGE-379): the one OpenRouter
 * decision model that judges which agent a message of a group chat means,
 * together with the default thresholds of the groups.
 *
 * @remarks
 * It is one setting of the instance next to the speech recognition. Only an
 * administrator in the active admin mode reads the form and saves. The model
 * comes from the OpenRouter models whose catalog states `decisions` among the
 * outputs (the rule `decision` of `modelConsumerRefusal`); it runs no tool
 * and no action, because it only gives probabilities. A saved model the
 * catalog no longer lists keeps its value and counts as unavailable.
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
      listDecisionModels(this.dependencies, viewer),
    ]);
    return {
      settings,
      status: statusOf(settings.selection, models),
      models,
      emptyReason: await this.emptyReason(models, viewer),
    };
  }

  /**
   * Saves the decision model and the default rules.
   *
   * @param actor - The administrator in the admin mode.
   * @param input - The choice and rules with the revision they were read at;
   * a `null` choice removes the model.
   * @throws {AgentError} `provider_model_not_found` for a model the catalog
   * does not list as a decision model, `profile_invalid` for rules out of
   * range or a reasoning level, which decision models do not have,
   * `profile_conflict` after a concurrent change.
   */
  public async save(
    actor: AccountAccess,
    input: ChatDecisionSettingsInput,
  ): Promise<void> {
    requireAgentAdministrator(actor);
    const { selection, rules } = input;
    if (!isValidDecisionRules(rules)) throw new AgentError("profile_invalid");
    if (selection !== null) {
      if (selection.reasoningEffort !== null)
        throw new AgentError("profile_invalid");
      const models = await listDecisionModels(
        this.dependencies,
        await this.viewer(actor),
      );
      if (findDecisionModel(models, selection) === null)
        throw new AgentError("provider_model_not_found");
    }
    await this.writes.run(() =>
      this.dependencies.settings.save({
        selection,
        rules,
        revision: input.revision,
      }),
    );
  }

  /**
   * The model that decides now, for every group of the instance.
   *
   * @returns Where it runs and which model it is, or `null` while none is
   * chosen or the chosen one is no longer listed; the groups then behave like
   * "Nur @".
   */
  public async resolve(): Promise<ResolvedDecisionModel | null> {
    const { selection } = await this.dependencies.settings.read();
    if (selection === null) return null;
    const models = await listDecisionModels(this.dependencies, null);
    if (findDecisionModel(models, selection) === null) return null;
    return { connectionId: selection.connectionId, model: selection.model };
  }

  /**
   * The default thresholds and the most answering agents of the instance.
   *
   * @returns The rules a group follows without values of its own.
   */
  public async rules(): Promise<ConversationDecisionRules> {
    return (await this.dependencies.settings.read()).rules;
  }

  /**
   * The decision model as the popup of a group shows it.
   *
   * @returns Its state and name; it names no connection detail.
   */
  public async modelView(): Promise<ConversationDecisionModelView> {
    const { selection } = await this.dependencies.settings.read();
    if (selection === null) return { status: "noModel", name: null };
    const model = findDecisionModel(
      await listDecisionModels(this.dependencies, null),
      selection,
    );
    return model === null
      ? { status: "modelUnavailable", name: selection.model }
      : { status: "ready", name: model.modelName ?? model.model };
  }

  /** Public health state without model names, connection details or credentials. */
  public async currentStatus(): Promise<ChatDecisionStatus> {
    return (await this.modelView()).status;
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

  private async viewer(actor: AccountAccess): Promise<AgentViewer> {
    return {
      actor,
      groupIds: await this.dependencies.groups.findIdsByMember(actor.userId),
    };
  }
}
