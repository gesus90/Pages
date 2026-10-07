import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

const MAXIMUM_DESCRIPTION_LENGTH = 10_000;
const MAXIMUM_TITLE_LENGTH = 200;

/** Trims an optional text, treating empty values as missing. */
export function trimOrNull(value: string | null | undefined): string | null {
  return value ? value.trim() : null;
}

/** Checks the title and description of a work item against their limits. */
export function validateWorkItemText(title: string, description: string): void {
  if (!title || title.length > MAXIMUM_TITLE_LENGTH) {
    throw new WorkItemValidationError("titleLength");
  }

  if (description.length > MAXIMUM_DESCRIPTION_LENGTH) {
    throw new WorkItemValidationError("descriptionTooLong");
  }
}
