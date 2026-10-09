import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";
import { WORK_ITEM_LIMITS } from "@/definition/Task";

/** Trims an optional text, treating empty values as missing. */
export function trimOrNull(value: string | null | undefined): string | null {
  return value ? value.trim() : null;
}

/** Checks the title and description of a work item against their limits. */
export function validateWorkItemText(title: string, description: string): void {
  if (!title || title.length > WORK_ITEM_LIMITS.titleLength) {
    throw new WorkItemValidationError("titleLength");
  }

  validateDescription(description);
}

/** Checks a description against its limit. */
export function validateDescription(description: string): void {
  if (description.length > WORK_ITEM_LIMITS.descriptionLength) {
    throw new WorkItemValidationError("descriptionTooLong");
  }
}
