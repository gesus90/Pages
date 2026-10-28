import { ACTOR, formOf, servicesOf } from "../../actions/action-fixtures";

import type { ProjectActionContext } from "@/app/lib/project-actions/project-action-support.server";
import type { FormFields } from "../../actions/action-fixtures";

/** The project every synthetic project action addresses. */
export const PROJECT_ID = "project-1";

/**
 * Builds the context of a project detail action handler.
 *
 * @param services - Service fakes the handler may call.
 * @param fields - Form fields of the submission.
 */
export function projectContext(
  services: object,
  fields: FormFields = {},
): ProjectActionContext {
  return {
    actor: ACTOR,
    formData: formOf(fields),
    projectId: PROJECT_ID,
    services: servicesOf(services),
  };
}
