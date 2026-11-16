/**
 * Contracts of the scheduled tasks of chat agents.
 * @remarks
 * In a chat a person tells an agent "Erinnere mich morgen um 9" or "Prüfe
 * jeden Montag die offenen Tickets"; the agent plans it with its tool
 * `aufgabe_planen`. Pages stores it as an automation of the
 * person who asked, bound to the chat: it runs in the agent's session of
 * that chat and its result is a message there. The binding goes with the
 * chat: dissolving the group or deleting the direct chat removes the task.
 */

import type { AutomationTrigger } from "./Automation";

/** Whether the task only reminds of something or has the agent work on an instruction. */
export const AGENT_CHAT_TASK_KINDS = ["reminder", "task"] as const;
/** Whether the task only reminds of something or has the agent work on an instruction. */
export type AgentChatTaskKind = (typeof AGENT_CHAT_TASK_KINDS)[number];

/** The tasks one chat holds while the instance names no other limit. */
export const AGENT_CHAT_TASK_LIMIT_DEFAULT = 20;

/** The range of the limit of tasks per chat an administrator may set. */
export const AGENT_CHAT_TASK_LIMIT_RANGE = {
  minimum: 1,
  maximum: 200,
} as const;

/** The shortest interval of a recurring task, in minutes, so no chat is flooded. */
export const AGENT_CHAT_TASK_MINIMUM_INTERVAL_MINUTES = 5;

/** The longest original request and instruction a task keeps. */
export const AGENT_CHAT_TASK_TEXT_LENGTH = 2_000;

/**
 * When a task runs, as the agent plans it.
 * @remarks
 * Times are wall-clock times in the time zone of the person who asked:
 * `at` is `YYYY-MM-DDTHH:MM`, `times` are `HH:MM`, weekdays ISO (1 Monday
 * to 7 Sunday). Pages computes the instants; the agent never names a zone.
 */
export type AgentChatTaskSchedule =
  | { readonly type: "once"; readonly at: string }
  | {
      readonly type: "interval";
      readonly every: number;
      readonly unit: "minute" | "hour" | "day";
    }
  | {
      readonly type: "weekly";
      readonly weekdays: readonly number[];
      readonly times: readonly string[];
    };

/** The chat a task is bound to. */
export type AgentChatTaskChat =
  | { readonly kind: "direct"; readonly personId: string }
  | {
      readonly kind: "conversation";
      readonly conversationId: string;
      /** The person who addressed the agent; `null` when nobody did, which plans nothing. */
      readonly askerId: string | null;
    };

/** One scheduled task of a chat. */
export interface AgentChatTaskView {
  /** The ID of the automation behind the task. */
  readonly id: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly kind: AgentChatTaskKind;
  /** What the person asked for, as the agent summarized it. */
  readonly request: string;
  /** What the agent does at the time; the reminder text for a reminder. */
  readonly instruction: string;
  readonly trigger: AutomationTrigger;
  readonly isActive: boolean;
  /** ISO 8601 moment of the next run; `null` while paused or done. */
  readonly nextRunAt: string | null;
  readonly requesterId: string;
  readonly requesterName: string;
  readonly createdAt: string;
}

/** What the agent plans with `aufgabe_planen`. */
export interface AgentChatTaskRequest {
  readonly kind: AgentChatTaskKind;
  readonly request: string;
  readonly instruction: string;
  readonly schedule: AgentChatTaskSchedule;
}

/** A change of a planned task: any of its fields, or pausing and resuming it. */
export interface AgentChatTaskChange {
  readonly request?: string;
  readonly instruction?: string;
  readonly schedule?: AgentChatTaskSchedule;
  readonly isActive?: boolean;
}

/** A planned or changed task with the plain-language confirmation of its time. */
export interface AgentChatTaskReceipt {
  readonly task: AgentChatTaskView;
  /** "Morgen, 16.11., 9:00 Uhr" or "Jeden Montag um 9:00 Uhr", in the language of the person. */
  readonly when: string;
}

/** The scheduled tasks of one job, bound to its agent and its chat. */
export interface AgentChatTasks {
  /** Plans a task in the chat for the person who asked. */
  create(request: AgentChatTaskRequest): Promise<AgentChatTaskReceipt>;
  /** The tasks of this agent in this chat. */
  list(): Promise<readonly AgentChatTaskReceipt[]>;
  /** Changes a task of this agent in this chat. */
  update(
    id: string,
    change: AgentChatTaskChange,
  ): Promise<AgentChatTaskReceipt>;
  /** Deletes a task of this agent in this chat. */
  remove(id: string): Promise<void>;
}

/** Why a scheduled task cannot be planned or changed. */
export type AgentChatTaskErrorCode =
  | "not_found"
  | "forbidden"
  | "limit_reached"
  | "time_in_past"
  | "invalid"
  | "run_active";
