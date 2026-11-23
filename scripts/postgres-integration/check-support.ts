import type { DatabaseValue } from "../../backend/database/Database";
import type { Migration } from "../../backend/database/Migration";

/** The outcome of one check of the suite. */
export interface CheckResult {
  readonly name: string;
  readonly status: "passed" | "failed";
  readonly milliseconds: number;
  /** What the check proved, or why it failed. */
  readonly detail: string;
}

/** What every check receives from the run. */
export interface IntegrationContext {
  /** Every migration of Pages, in name order. */
  readonly migrations: readonly Migration[];
  /**
   * Creates an empty database for one check, so no check sees the data of another.
   * @param name - Lower-case name of the database.
   * @returns Its private address.
   */
  readonly createDatabase: (name: string) => Promise<string>;
}

/**
 * Runs one check and turns an error into a failed result, so the later checks still run.
 * @param name - Name of the check in the report.
 * @param work - The check; it returns what it proved and throws when that is wrong.
 * @returns The result.
 */
export async function runCheck(
  name: string,
  work: () => Promise<string>,
): Promise<CheckResult> {
  const startedAt = performance.now();
  try {
    const detail = await work();
    return {
      name,
      status: "passed",
      milliseconds: Math.round(performance.now() - startedAt),
      detail,
    };
  } catch (error: unknown) {
    return {
      name,
      status: "failed",
      milliseconds: Math.round(performance.now() - startedAt),
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Reads the first column of the first row as a whole number.
 * @param rows - Rows of a `COUNT` query.
 * @returns The number.
 * @throws When the query returned something else.
 */
export function singleNumber(
  rows: readonly (readonly DatabaseValue[])[],
): number {
  const value = rows[0]?.[0];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error("The query did not return a number.");
}
