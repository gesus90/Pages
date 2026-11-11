import type {
  Automation,
  AutomationOptions,
  AutomationRunSummary,
} from "./Automation";

/** The data of the page `/automationen` (PAGE-297). */
export interface AutomationPageData {
  readonly automations: readonly Automation[];
  /** The newest runs of every visible automation, newest first. */
  readonly history: readonly AutomationRunSummary[];
  readonly options: AutomationOptions;
  /** Display names of agents, plans, projects, groups, workspaces and interpreter profiles by ID. */
  readonly names: Readonly<Record<string, string>>;
  /** The server time the data was read at, for relative times. */
  readonly readAt: string;
}

/** The changes the page sends, by the `intent` field. */
export const AUTOMATION_PAGE_INTENTS = [
  "create",
  "update",
  "setActive",
  "run",
  "delete",
] as const;

/** A change the page sends. */
export type AutomationPageIntent = (typeof AUTOMATION_PAGE_INTENTS)[number];

/** Why a change of the page was refused, as the service names it. */
export interface AutomationPageFailure {
  readonly code: string;
  readonly reason: string | null;
  readonly problems: readonly string[];
  readonly currentRevision: number | null;
}

/** The answer of a change of the page. */
export type AutomationPageActionData =
  | {
      readonly ok: true;
      readonly intent: AutomationPageIntent;
      /** The saved automation after create, update and setActive. */
      readonly automation?: Automation;
      /** The run that "run now" queued. */
      readonly runId?: string;
      /** Whether that run starts at once (`accepted`) or waits behind a running one (`queued`). */
      readonly runStatus?: "accepted" | "queued";
      /** The deleted automation. */
      readonly deletedId?: string;
    }
  | {
      readonly ok: false;
      readonly intent: AutomationPageIntent;
      readonly error: AutomationPageFailure;
    };
