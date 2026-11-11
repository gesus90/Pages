import type {
  Automation,
  AutomationDeleted,
  AutomationDeletionScope,
  AutomationOptions,
  AutomationPage,
  AutomationRunDetail,
  AutomationRunReceipt,
  AutomationRunSummary,
} from "./Automation";

/** Reads of automations and their runs (PAGE-297). */
export const AUTOMATION_READ_OPERATIONS = [
  "automations.options.read",
  "automations.list",
  "automations.read",
  "automations.runs.list",
  "automations.runs.read",
] as const;

/** Changes of automations; each carries an operation ID. */
export const AUTOMATION_WRITE_OPERATIONS = [
  "automations.create",
  "automations.update",
  "automations.setActive",
  "automations.run",
  "automations.delete",
] as const;

/** A read of automations. */
export type AutomationReadOperation =
  (typeof AUTOMATION_READ_OPERATIONS)[number];
/** A change of automations. */
export type AutomationWriteOperation =
  (typeof AUTOMATION_WRITE_OPERATIONS)[number];
/** Any operation of automations. */
export type AutomationOperation =
  AutomationReadOperation | AutomationWriteOperation;

/** What a read of automations answers. */
export type AutomationReadResult =
  | AutomationOptions
  | AutomationPage<Automation>
  | Automation
  | AutomationPage<AutomationRunSummary>
  | AutomationRunDetail;

/** What a change of automations answers; `replayed` marks a repeated operation ID. */
export type AutomationWriteResult =
  | (Automation & { readonly replayed?: boolean })
  | (AutomationRunReceipt & { readonly replayed?: boolean })
  | AutomationDeletionScope
  | (AutomationDeleted & { readonly replayed?: boolean });

/**
 * Tells whether a name is a read of automations.
 *
 * @param value - The requested operation name.
 */
export function isAutomationReadOperation(
  value: unknown,
): value is AutomationReadOperation {
  return AUTOMATION_READ_OPERATIONS.some((name) => name === value);
}

/**
 * Tells whether a name is an operation of automations.
 *
 * @param value - The requested operation name.
 */
export function isAutomationOperation(
  value: unknown,
): value is AutomationOperation {
  return (
    AUTOMATION_READ_OPERATIONS.some((name) => name === value) ||
    AUTOMATION_WRITE_OPERATIONS.some((name) => name === value)
  );
}
