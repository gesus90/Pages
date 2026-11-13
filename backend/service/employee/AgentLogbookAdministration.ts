import { z } from "zod";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import {
  AGENT_LOGBOOK_LIMIT_RANGE,
  AGENT_LOGBOOK_QUIET_RANGE,
} from "@/definition/AgentLogbook";

import type { StoredAgentLogbookEntry } from "@/backend/database/repositories/employee/AgentLogbookRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { StoredLogbookModel } from "@/backend/database/repositories/employee/AgentSessionSettingsRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type {
  AgentLogbookChatOption,
  AgentLogbookEntryView,
  AgentLogbookModelChoice,
  AgentLogbookOverview,
} from "@/definition/AgentLogbook";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { User } from "@/definition/User";
import type { AgentChatSessionViewer } from "./AgentChatSessionService";
import type { AgentLogbookService } from "./AgentLogbookService";

/** The entries the tab reads at most: the largest limit an agent can have. */
const LIST_LIMIT = AGENT_LOGBOOK_LIMIT_RANGE.maximum;
/** The entries one call removes at most. */
const REMOVE_LIMIT = 200;

/** What the tab "Lagebuch" is read and changed with. */
export interface AgentLogbookAdministrationDependencies {
  readonly store: Pick<EmployeeStore, "logbook">;
  readonly users: Pick<UserRepository, "findById">;
  readonly logbook: Pick<AgentLogbookService, "trim">;
  /** Whether a person takes part in a conversation. */
  readonly isMember: (conversationId: string, userId: string) => Promise<boolean>;
  /** The models an administrator may give an agent. */
  readonly models: (userId: string) => Promise<readonly PageAgentModel[]>;
  /** The model the instance names for the summary; `null` without one. */
  readonly instanceModel: () => Promise<StoredLogbookModel | null>;
}

/** An empty form field counts as absent. */
const optionalText = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().min(1).max(300).nullable(),
);

const settingsInput = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(AGENT_LOGBOOK_LIMIT_RANGE.minimum)
      .max(AGENT_LOGBOOK_LIMIT_RANGE.maximum),
    quietMinutes: z.coerce
      .number()
      .int()
      .min(AGENT_LOGBOOK_QUIET_RANGE.minimum)
      .max(AGENT_LOGBOOK_QUIET_RANGE.maximum),
    modelConnectionId: optionalText,
    model: optionalText,
  })
  .refine((input) => (input.modelConnectionId === null) === (input.model === null));

const removeInput = z.array(z.string().min(1).max(100)).min(1).max(REMOVE_LIMIT);

function choiceOf(model: PageAgentModel): AgentLogbookModelChoice[] {
  return model.connectionId === undefined
    ? []
    : [
        {
          connectionId: model.connectionId,
          model: model.model,
          label: model.name,
        },
      ];
}

function toView(entry: StoredAgentLogbookEntry): AgentLogbookEntryView {
  return {
    id: entry.id,
    kind: entry.kind,
    text: entry.text,
    topic: entry.topic,
    at: entry.createdAt,
    source: entry.source,
    participants: entry.participants,
    origin: entry.origin,
  };
}

/**
 * The tab "Lagebuch" of the agent settings (PAGE-377): the entries a viewer
 * may see, the settings of the agent and the removal of entries.
 *
 * @remarks
 * A viewer sees the entries of the chats they take part in: their own direct
 * chat with the agent and the groups they belong to; an administrator sees
 * all entries of the agent. Entries of confidential chats are never listed.
 * Whoever sees an entry may remove it; saving the limit, the quiet time and
 * the model of the agent needs an administrator.
 */
export class AgentLogbookAdministration {
  private readonly dependencies: AgentLogbookAdministrationDependencies;

  public constructor(dependencies: AgentLogbookAdministrationDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads the Lagebuch of an agent as the viewer may see it.
   *
   * @throws {AgentEmployeeError} `notFound` for an account that is no agent.
   */
  public async overview(
    viewer: AgentChatSessionViewer,
    agentId: string,
  ): Promise<AgentLogbookOverview> {
    const agent = await this.requireAgent(agentId);
    const { store } = this.dependencies;
    const [settings, count, stored, instanceModel, models] = await Promise.all([
      store.logbook().settings(agentId),
      store.logbook().count(agentId),
      store
        .logbook()
        .find(agentId, { words: [], chat: null, limit: LIST_LIMIT }),
      this.dependencies.instanceModel(),
      viewer.isAdministrator
        ? this.dependencies.models(viewer.user.id)
        : Promise.resolve([]),
    ]);
    if (!settings) throw new AgentEmployeeError("notFound");
    const visible = await this.visible(viewer, stored);
    const choices = models.flatMap(choiceOf);
    return {
      agentId,
      agentName: agent.displayName,
      entries: visible.map(toView),
      count,
      fillPercent: Math.min(100, Math.round((count / settings.limit) * 100)),
      settings: {
        limit: settings.limit,
        quietMinutes: settings.quietMinutes,
        model:
          settings.connectionId !== null && settings.model !== null
            ? { connectionId: settings.connectionId, model: settings.model }
            : null,
      },
      instanceModel: instanceModel
        ? {
            ...instanceModel,
            label:
              choices.find(
                (choice) =>
                  choice.connectionId === instanceModel.connectionId &&
                  choice.model === instanceModel.model,
              )?.label ?? instanceModel.model,
          }
        : null,
      models: choices,
      chats: this.chatsOf(visible),
      canChangeSettings: viewer.isAdministrator,
    };
  }

  /**
   * Saves the limit, the quiet time and the summary model of an agent, and
   * drops the oldest entries beyond a lowered limit.
   *
   * @throws {AgentEmployeeError} `forbidden` for a viewer who is no
   * administrator, `invalidInput` for a value outside its range or a model
   * the administrator may not choose, `notFound` for an account that is no
   * agent.
   */
  public async saveSettings(
    viewer: AgentChatSessionViewer,
    agentId: string,
    input: unknown,
  ): Promise<void> {
    if (!viewer.isAdministrator) throw new AgentEmployeeError("forbidden");
    await this.requireAgent(agentId);
    const parsed = settingsInput.safeParse(input);
    if (!parsed.success) throw new AgentEmployeeError("invalidInput");
    const { modelConnectionId, model } = parsed.data;
    const chosen =
      modelConnectionId !== null && model !== null
        ? { connectionId: modelConnectionId, model }
        : null;
    if (chosen !== null && !(await this.isAllowed(viewer.user.id, chosen)))
      throw new AgentEmployeeError("invalidInput");
    const isSaved = await this.dependencies.store.logbook().saveSettings(agentId, {
      limit: parsed.data.limit,
      quietMinutes: parsed.data.quietMinutes,
      model: chosen,
    });
    if (!isSaved) throw new AgentEmployeeError("notFound");
    await this.dependencies.logbook.trim(agentId);
  }

  /**
   * Removes entries the viewer sees; IDs of entries they do not see, of other
   * agents or of none are ignored.
   *
   * @throws {AgentEmployeeError} `invalidInput` for a malformed list,
   * `notFound` for an account that is no agent.
   */
  public async remove(
    viewer: AgentChatSessionViewer,
    agentId: string,
    ids: unknown,
  ): Promise<number> {
    await this.requireAgent(agentId);
    const parsed = removeInput.safeParse(ids);
    if (!parsed.success) throw new AgentEmployeeError("invalidInput");
    const logbook = this.dependencies.store.logbook();
    const entries = await logbook.byIds(agentId, parsed.data);
    const allowed = await this.visible(viewer, entries);
    return logbook.remove(
      agentId,
      allowed.map((entry) => entry.id),
    );
  }

  private async isAllowed(
    administratorId: string,
    chosen: { readonly connectionId: string; readonly model: string },
  ): Promise<boolean> {
    const models = await this.dependencies.models(administratorId);
    return models.some(
      (model) =>
        model.connectionId === chosen.connectionId &&
        model.model === chosen.model,
    );
  }

  /** The entries of the chats the viewer takes part in; an administrator sees all. */
  private async visible(
    viewer: AgentChatSessionViewer,
    entries: readonly StoredAgentLogbookEntry[],
  ): Promise<StoredAgentLogbookEntry[]> {
    if (viewer.isAdministrator) return [...entries];
    const memberships = new Map<string, boolean>();
    const result: StoredAgentLogbookEntry[] = [];
    for (const entry of entries) {
      if (entry.source.kind === "direct") {
        if (entry.source.id === viewer.user.id) result.push(entry);
        continue;
      }
      const known = memberships.get(entry.source.id);
      const isMember =
        known ??
        (await this.dependencies.isMember(entry.source.id, viewer.user.id));
      memberships.set(entry.source.id, isMember);
      if (isMember) result.push(entry);
    }
    return result;
  }

  /** The chats the visible entries come from, named as their newest entry names them. */
  private chatsOf(
    entries: readonly StoredAgentLogbookEntry[],
  ): AgentLogbookChatOption[] {
    const chats = new Map<string, AgentLogbookChatOption>();
    for (const entry of entries) {
      const key = `${entry.source.kind}:${entry.source.id}`;
      if (!chats.has(key)) chats.set(key, entry.source);
    }
    return [...chats.values()];
  }

  private async requireAgent(agentId: string): Promise<User> {
    const agent = await this.dependencies.users.findById(agentId);
    if (agent?.isAgent !== true) throw new AgentEmployeeError("notFound");
    return agent;
  }
}
