import {
  ACTOR,
  formOf,
  outcomeOf,
  servicesOf,
} from "../../actions/action-fixtures";

import type {
  TaskActionContext,
  TaskActionHandler,
} from "@/app/lib/task-actions/task-action-support.server";
import type { ActionOutcome, FormFields } from "../../actions/action-fixtures";

/**
 * Builds the context of a ticket action handler.
 *
 * @param services - Service fakes the handler may call.
 * @param fields - Form fields of the submission.
 */
export function taskContext(
  services: object,
  fields: FormFields = {},
): TaskActionContext {
  return {
    actor: ACTOR,
    formData: formOf(fields),
    services: servicesOf(services),
  };
}

/**
 * Runs a ticket action handler and normalizes its answer.
 *
 * @param handler - The handler under test.
 * @param services - Service fakes the handler may call.
 * @param fields - Form fields of the submission.
 * @returns Status, body and redirect location of the answer.
 */
export async function runTaskHandler(
  handler: TaskActionHandler,
  services: object,
  fields: FormFields,
): Promise<ActionOutcome> {
  return outcomeOf(await handler(taskContext(services, fields)));
}
