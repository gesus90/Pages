import { useState } from "react";

import { validateSetupFields } from "@/definition/Setup";

import type { SetupField, SetupFieldErrors } from "@/definition/Setup";

/** The steps of the wizard in their order. */
export const SETUP_STEPS = [
  "welcome",
  "company",
  "administrator",
  "database",
] as const;

/** One step of the wizard. */
export type SetupStep = (typeof SETUP_STEPS)[number];

/** Fields each step asks for. */
const FIELDS_BY_STEP: Readonly<Record<SetupStep, readonly SetupField[]>> = {
  administrator: ["username", "password", "email"],
  company: ["companyName"],
  database: ["databasePath"],
  welcome: [],
};

/** Values entered in the wizard; they only live in memory. */
export interface SetupDraftValues {
  readonly companyName: string;
  readonly username: string;
  readonly password: string;
  readonly email: string;
  readonly databasePath: string;
}

/** The entered values, the current step, and how to move between steps. */
export interface SetupDraft {
  readonly values: SetupDraftValues;
  readonly step: SetupStep;
  readonly stepIndex: number;
  readonly fieldErrors: SetupFieldErrors;
  readonly setField: (field: SetupField, value: string) => void;
  readonly goBack: () => void;
  readonly goForward: () => void;
  /** Shows errors the server reported and opens the first affected step. */
  readonly showFieldErrors: (errors: SetupFieldErrors) => void;
}

const EMPTY_VALUES = {
  companyName: "",
  email: "",
  password: "",
  username: "",
};

function findFirstStepWithError(errors: SetupFieldErrors): number {
  return SETUP_STEPS.findIndex((step) =>
    FIELDS_BY_STEP[step].some((field) => errors[field] !== undefined),
  );
}

/**
 * Keeps the values and the step of the wizard.
 *
 * @param suggestedDatabasePath - Path the server suggests, used until the
 * field is edited; `null` before access was granted.
 *
 * @remarks
 * Moving forward checks the fields of the current step with the same rules
 * the server applies. Moving back never loses entered values.
 */
export function useSetupDraft(
  suggestedDatabasePath: string | null,
): SetupDraft {
  const [enteredValues, setEnteredValues] = useState(EMPTY_VALUES);
  const [databasePath, setDatabasePath] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<SetupFieldErrors>({});
  const step = SETUP_STEPS[stepIndex];
  const values = {
    ...enteredValues,
    databasePath: databasePath ?? suggestedDatabasePath ?? "",
  };

  function setField(field: SetupField, value: string): void {
    if (field === "databasePath") {
      setDatabasePath(value);
    } else {
      setEnteredValues((current) => ({ ...current, [field]: value }));
    }

    setFieldErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([errorField]) => errorField !== field),
      ),
    );
  }

  function goForward(): void {
    const stepErrors = Object.fromEntries(
      Object.entries(validateSetupFields(values)).filter(([field]) =>
        FIELDS_BY_STEP[step].some((stepField) => stepField === field),
      ),
    );

    setFieldErrors(stepErrors);

    if (Object.keys(stepErrors).length === 0) {
      setStepIndex(Math.min(stepIndex + 1, SETUP_STEPS.length - 1));
    }
  }

  function showFieldErrors(errors: SetupFieldErrors): void {
    setFieldErrors(errors);
    setStepIndex(Math.max(findFirstStepWithError(errors), 0));
  }

  return {
    fieldErrors,
    goBack: () => setStepIndex(Math.max(stepIndex - 1, 0)),
    goForward,
    setField,
    showFieldErrors,
    step,
    stepIndex,
    values,
  };
}
