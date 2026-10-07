import type { WorkItemPriority, WorkItemType } from "@/definition/Task";

/** Who may use a ticket template; `private` keeps it to its owner. */
export const TEMPLATE_SCOPE = {
  PRIVATE: "private",
  ALL: "all",
  DEPARTMENTS: "departments",
  PROJECTS: "projects",
} as const;

/** The audience a ticket template is shared with. */
export type TemplateScope =
  (typeof TEMPLATE_SCOPE)[keyof typeof TEMPLATE_SCOPE];

/**
 * Narrows an unknown value to a supported template scope.
 *
 * @param value - Value received from an untrusted source.
 * @returns Whether the value is a valid template scope.
 */
export function isTemplateScope(value: unknown): value is TemplateScope {
  return (
    typeof value === "string" &&
    (Object.values(TEMPLATE_SCOPE) as readonly string[]).includes(value)
  );
}

/** Who a template is shared with; the id lists matter for their scope only. */
export interface TemplateSharing {
  readonly scope: TemplateScope;
  readonly departmentIds: readonly string[];
  readonly projectIds: readonly string[];
}

/** The ticket content a template presets; never assignee, milestone, dates or department. */
export interface TemplateContent {
  readonly type: WorkItemType;
  readonly title: string;
  readonly description: string;
  readonly priority: WorkItemPriority;
  readonly labelIds: readonly string[];
  readonly checklist: readonly string[];
}

/** A stored ticket template. */
export interface WorkItemTemplate extends TemplateSharing, TemplateContent {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A template as shown to one user, with the server's decision on managing it. */
export interface WorkItemTemplateView extends WorkItemTemplate {
  readonly canManage: boolean;
}

/** What a user enters when saving or reshaping a template: its name and audience. */
export interface TemplateDetailsInput extends TemplateSharing {
  readonly name: string;
}
