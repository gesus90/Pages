import { isMilestoneColor, isMilestoneIcon } from "@/definition/Task";
import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

import type { WorkItemErrorCode } from "@/backend/error/WorkItemErrors";
import type { MilestoneColor, MilestoneIcon } from "@/definition/Task";

const MAXIMUM_NAME_LENGTH = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** The fields of a milestone that creating and updating one both validate. */
export interface MilestoneFields {
  readonly name: string;
  readonly startAt?: string | null;
  readonly dueAt?: string | null;
  readonly colorKey?: MilestoneColor | null;
  readonly iconKey?: MilestoneIcon | null;
  readonly colorCustom?: string | null;
}

/** Milestone fields after trimming, with every missing value as `null`. */
export interface ValidMilestoneFields {
  readonly name: string;
  readonly startAt: string | null;
  readonly dueAt: string | null;
  readonly colorKey: MilestoneColor | null;
  readonly iconKey: MilestoneIcon | null;
  readonly colorCustom: string | null;
}

function parseDate(
  value: string | null | undefined,
  errorCode: WorkItemErrorCode,
): string | null {
  const date = value?.trim();

  if (date === undefined || date === "") {
    return null;
  }

  if (!DATE_PATTERN.test(date)) {
    throw new WorkItemValidationError(errorCode);
  }

  return date;
}

function requireOptional<Value>(
  value: Value | null | undefined,
  isValid: (candidate: unknown) => boolean,
  errorCode: WorkItemErrorCode,
): Value | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isValid(value)) {
    throw new WorkItemValidationError(errorCode);
  }

  return value;
}

/**
 * Validates and normalizes the fields shared by creating and updating a milestone.
 *
 * @param input - The fields as received from the caller.
 * @returns The trimmed name, the dates, and the optional look as `null` when missing.
 * @throws WorkItemValidationError When a field is missing, malformed or inconsistent.
 */
export function validateMilestoneInput(
  input: MilestoneFields,
): ValidMilestoneFields {
  const name = input.name.trim();
  const startAt = parseDate(input.startAt, "milestoneStartDateFormat");
  const dueAt = parseDate(input.dueAt, "milestoneDueDateFormat");

  if (!name || name.length > MAXIMUM_NAME_LENGTH) {
    throw new WorkItemValidationError("milestoneNameLength");
  }

  if (startAt && dueAt && startAt > dueAt) {
    throw new WorkItemValidationError("milestoneDateOrder");
  }

  return {
    colorCustom: requireOptional(
      input.colorCustom,
      (candidate) =>
        typeof candidate === "string" && HEX_COLOR_PATTERN.test(candidate),
      "milestoneCustomColorFormat",
    ),
    colorKey: requireOptional(
      input.colorKey,
      isMilestoneColor,
      "milestoneColorUnsupported",
    ),
    dueAt,
    iconKey: requireOptional(
      input.iconKey,
      isMilestoneIcon,
      "milestoneIconUnsupported",
    ),
    name,
    startAt,
  };
}
