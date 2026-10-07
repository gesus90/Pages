import { useState } from "react";

import type {
  TemplateScope,
  TemplateSharing,
} from "@/definition/WorkItemTemplate";

/** The audience a template form edits and the ways to change it. */
export interface TemplateSharingState extends TemplateSharing {
  readonly setScope: (scope: TemplateScope) => void;
  readonly toggleDepartment: (departmentId: string) => void;
  readonly toggleProject: (projectId: string) => void;
}

function toggled(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
}

/**
 * Keeps the audience of a template while its form is edited.
 *
 * @param initial - The audience the form starts with.
 */
export function useTemplateSharing(
  initial: TemplateSharing,
): TemplateSharingState {
  const [scope, setScope] = useState(initial.scope);
  const [departmentIds, setDepartmentIds] = useState(initial.departmentIds);
  const [projectIds, setProjectIds] = useState(initial.projectIds);

  return {
    departmentIds,
    projectIds,
    scope,
    setScope,
    toggleDepartment: (departmentId) =>
      setDepartmentIds((current) => toggled(current, departmentId)),
    toggleProject: (projectId) =>
      setProjectIds((current) => toggled(current, projectId)),
  };
}
