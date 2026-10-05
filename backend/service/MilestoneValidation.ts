import { isMilestoneColor, isMilestoneIcon } from "@/definition/Task";
import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

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
  label: string,
): string | null {
  const date = value?.trim();

  if (date === undefined || date === "") {
    return null;
  }

  if (!DATE_PATTERN.test(date)) {
    throw new WorkItemValidationError(
      `Milestone ${label} date must use the format YYYY-MM-DD.`,
    );
  }

  return date;
}

function requireOptional<Value>(
  value: Value | null | undefined,
  isValid: (candidate: unknown) => boolean,
  message: string,
): Value | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isValid(value)) {
    throw new WorkItemValidationError(message);
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
  const startAt = parseDate(input.startAt, "start");
  const dueAt = parseDate(input.dueAt, "due");

  if (!name || name.length > MAXIMUM_NAME_LENGTH) {
    throw new WorkItemValidationError(
      "Milestone name must be between 1 and 200 characters.",
    );
  }

  if (startAt && dueAt && startAt > dueAt) {
    throw new WorkItemValidationError(
      "Milestone start date must not be after its due date.",
    );
  }

  return {
    colorCustom: requireOptional(
      input.colorCustom,
      (candidate) =>
        typeof candidate === "string" && HEX_COLOR_PATTERN.test(candidate),
      "Milestone custom color must use the format #RRGGBB.",
    ),
    colorKey: requireOptional(
      input.colorKey,
      isMilestoneColor,
      "Milestone color must be a supported color type.",
    ),
    dueAt,
    iconKey: requireOptional(
      input.iconKey,
      isMilestoneIcon,
      "Milestone icon must be a supported symbol.",
    ),
    name,
    startAt,
  };
}
