import { z } from "zod";

import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logCaughtError } from "@/backend/logging/Logger";

import { chatModelLabel } from "./AgentChatModelChoices";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type {
  AgentChatControlTarget,
  AgentChatModelChoice,
  AgentChatModelOverview,
  AgentChatModelSetting,
} from "@/definition/AgentChatControl";
import type { User } from "@/definition/User";
import type { AgentChatAccess, AgentChatScope } from "./AgentChatAccess";
import type { AgentChatModelChoices } from "./AgentChatModelChoices";
import type { AgentChatSessionLifecycle } from "./AgentChatSessionLifecycle";

const COMPONENT = "AgentChatControlService";

/** German names of the reasoning levels in a system line; another level keeps its ID. */
const EFFORT_NAMES: Readonly<Record<string, string>> = {
  none: "ohne",
  minimal: "minimal",
  low: "niedrig",
  medium: "mittel",
  high: "hoch",
  xhigh: "sehr hoch",
  max: "max",
};

/** What the control of agents in a chat runs on. */
export interface AgentChatControlDependencies {
  readonly store: EmployeeStore;
  readonly access: AgentChatAccess;
  readonly choices: Pick<AgentChatModelChoices, "choices" | "pick">;
  readonly lifecycle: Pick<AgentChatSessionLifecycle, "restart" | "renew">;
  /** Stores a system line in the chat, in the name of the person who caused it. */
  readonly systemLine: (
    person: User,
    line: {
      readonly kind: "direct" | "group";
      readonly chatId: string;
      readonly agentId: string;
      readonly text: string;
    },
  ) => Promise<void>;
  readonly now?: () => Date;
}

const settingInput = z.object({
  connectionId: z.string().min(1).max(200),
  model: z.string().min(1).max(300),
  reasoningEffort: z.string().min(1).max(40).nullable(),
});

/**
 * How a model with its level reads in a system line, such as "Claude Opus
 * 5.5 · hoch".
 * @param name - The name of the model.
 * @param effort - The reasoning level; `null` names none.
 */
export function modelLine(name: string, effort: string | null): string {
  return effort === null ? name : `${name} · ${EFFORT_NAMES[effort] ?? effort}`;
}

/**
 * The model and the session of an agent in one chat: the choice
 * of a model and a reasoning level instead of the agent's own, the reset to
 * it, the restart with an empty session (`/new`) and the compaction
 * (`/compact`).
 *
 * @remarks
 * A change of the model ends the session of the agent in the chat on
 * purpose: a running answer ends first, the agent writes its state down as a
 * summary, then the next round starts with the new model, that summary,
 * `MEMORY.md`, `DREAM.md` and the last messages of the chat. The lifecycle
 * runs one change of a session at a time, so a second session of the agent
 * in the chat never runs. The choice lasts until somebody resets it. Every
 * change leaves a system line all members see. Nothing touches `MEMORY.md`,
 * `DREAM.md`, lessons, recipes or the Lagebuch.
 */
export class AgentChatControlService {
  private readonly dependencies: AgentChatControlDependencies;

  public constructor(dependencies: AgentChatControlDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * The models the agent can answer with in the chat, its own and the
   * chosen one.
   *
   * @throws {AgentEmployeeError} `notFound` for a chat the viewer does not take part in.
   */
  public async overview(
    viewer: User,
    target: AgentChatControlTarget,
  ): Promise<AgentChatModelOverview> {
    const scope = await this.dependencies.access.scope(viewer, target);
    return this.overviewOf(scope);
  }

  /**
   * Chooses a model and a reasoning level for the agent in the chat, or
   * resets it with `null`, and switches its session.
   *
   * @throws {AgentEmployeeError} `forbidden` for a viewer without the right,
   * `modelNotAllowed` for a model outside the choice or a level it does not
   * offer, `invalidInput` for a malformed choice.
   */
  public async setModel(
    viewer: User,
    target: AgentChatControlTarget,
    input: unknown,
  ): Promise<AgentChatModelOverview> {
    const scope = await this.requireControl(viewer, target);
    const choices = await this.dependencies.choices.choices(scope.employee);
    const key = {
      agentId: scope.agent.id,
      chatKind: scope.kind,
      chatId: scope.chatId,
    };
    const models = this.dependencies.store.chatModels();
    if (input === null) {
      await models.remove(key);
      await this.switchSession(scope);
      const label = chatModelLabel(scope.employee, choices, false);
      await this.announce(viewer, scope, {
        text: `${viewer.displayName} hat ${scope.agent.displayName} in diesem Chat auf das Standardmodell ${modelLine(label.name, label.reasoningEffort)} zurückgesetzt.`,
      });
      return this.overviewOf(scope, choices);
    }
    const setting = this.readSetting(input);
    const choice = this.dependencies.choices.pick(choices, setting);
    if (choice === null) throw new AgentEmployeeError("modelNotAllowed");
    await models.save(
      { ...key, ...setting },
      { changedBy: viewer.id, changedAt: this.now() },
    );
    await this.switchSession(scope);
    await this.announce(viewer, scope, {
      text: `${viewer.displayName} hat ${scope.agent.displayName} in diesem Chat auf ${modelLine(choice.name, setting.reasoningEffort)} umgestellt.`,
    });
    return this.overviewOf(scope, choices);
  }

  /**
   * Replaces the session of the agent in the chat by a new, empty one
   * (`/new`); the model of the chat stays.
   *
   * @throws {AgentEmployeeError} `forbidden` for a viewer without the right.
   */
  public async renew(
    viewer: User,
    target: AgentChatControlTarget,
  ): Promise<AgentChatScope> {
    const scope = await this.requireControl(viewer, target);
    if (scope.sessionId !== null) {
      const { sessionId } = scope;
      this.inBackground("agent_chat_renew", () =>
        this.dependencies.lifecycle.renew(scope.agent, sessionId),
      );
    }
    await this.announce(viewer, scope, {
      text: `${viewer.displayName} hat die Sitzung von ${scope.agent.displayName} neu gestartet.`,
    });
    return scope;
  }

  /**
   * Compacts the session of the agent in the chat now (`/compact`), whatever
   * its context fill: the same restart with a summary as at the threshold.
   *
   * @throws {AgentEmployeeError} `forbidden` for a viewer without the right.
   */
  public async compact(
    viewer: User,
    target: AgentChatControlTarget,
  ): Promise<AgentChatScope> {
    const scope = await this.requireControl(viewer, target);
    await this.switchSession(scope);
    await this.announce(viewer, scope, {
      text: `${viewer.displayName} hat die Sitzung von ${scope.agent.displayName} verdichtet.`,
    });
    return scope;
  }

  /**
   * The agent of the chat when the viewer may steer it.
   *
   * @throws {AgentEmployeeError} `forbidden` for a viewer without the right.
   */
  public async requireControl(
    viewer: User,
    target: AgentChatControlTarget,
  ): Promise<AgentChatScope> {
    const scope = await this.dependencies.access.scope(viewer, target);
    if (!scope.canControl) throw new AgentEmployeeError("forbidden");
    return scope;
  }

  /** The overview of a scope, with the choice when it was read already. */
  public async overviewOf(
    scope: AgentChatScope,
    known?: readonly AgentChatModelChoice[],
  ): Promise<AgentChatModelOverview> {
    const choices =
      known ?? (await this.dependencies.choices.choices(scope.employee));
    const stored = await this.dependencies.store.chatModels().find({
      agentId: scope.agent.id,
      chatKind: scope.kind,
      chatId: scope.chatId,
    });
    const standard: AgentChatModelSetting = {
      connectionId: scope.employee.connectionId,
      model: scope.employee.model,
      reasoningEffort: scope.employee.reasoningEffort,
    };
    return {
      agentId: scope.agent.id,
      agentName: scope.agent.displayName,
      standard: {
        ...standard,
        name: chatModelLabel(standard, choices, false).name,
      },
      override: stored
        ? {
            connectionId: stored.connectionId,
            model: stored.model,
            reasoningEffort: stored.reasoningEffort,
            name: chatModelLabel(stored, choices, true).name,
          }
        : null,
      choices,
      canControl: scope.canControl,
    };
  }

  /**
   * Ends the session on purpose: it restarts with a summary once a running
   * answer ended, and no round starts before (the mark makes it wait).
   */
  private async switchSession(scope: AgentChatScope): Promise<void> {
    const { sessionId } = scope;
    if (sessionId === null) return;
    await this.dependencies.store
      .chatSessions()
      .setNeedsRestart(sessionId, true);
    this.inBackground("agent_chat_switch", () =>
      this.dependencies.lifecycle.restart(scope.agent, sessionId),
    );
  }

  private async announce(
    viewer: User,
    scope: AgentChatScope,
    line: { readonly text: string },
  ): Promise<void> {
    try {
      await this.dependencies.systemLine(viewer, {
        kind: scope.kind,
        chatId: scope.chatId,
        agentId: scope.agent.id,
        text: line.text,
      });
    } catch (error: unknown) {
      // The change is made; a missing line must not report it as failed.
      logCaughtError(COMPONENT, error);
    }
  }

  private readSetting(input: unknown): AgentChatModelSetting {
    const parsed = settingInput.safeParse(input);
    if (!parsed.success) throw new AgentEmployeeError("invalidInput");
    return parsed.data;
  }

  /** Waits for a model or a running answer without holding the request. */
  private inBackground(name: string, work: () => Promise<void>): void {
    void withBackgroundDatabaseWork(name, work).catch((error: unknown) => {
      logCaughtError(COMPONENT, error);
    });
  }

  private now(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }
}
