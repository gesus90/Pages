import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
} from "@agentclientprotocol/sdk";

/** A select option of a session: its identifier, current value and choices. */
export interface AcpSelectOption {
  readonly id: string;
  readonly currentValue: string;
  /** Every selectable value, also those inside groups. */
  readonly values: readonly string[];
}

function values(
  entries: readonly (SessionConfigSelectOption | SessionConfigSelectGroup)[],
): readonly string[] {
  return entries.flatMap((entry) =>
    "group" in entry
      ? entry.options.map((option) => option.value)
      : [entry.value],
  );
}

/**
 * Finds a select option of a session by its identifier.
 *
 * @param options - The configuration options the agent reported.
 * @param id - The identifier, such as `model`.
 * @returns The option, or `null` when the agent offers no such select.
 */
export function findAcpSelectOption(
  options: readonly SessionConfigOption[],
  id: string,
): AcpSelectOption | null {
  for (const option of options) {
    if (option.id !== id || option.type !== "select") continue;
    return {
      id: option.id,
      currentValue: option.currentValue,
      values: values(option.options),
    };
  }
  return null;
}
