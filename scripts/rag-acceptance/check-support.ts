import type { AgentSourceSearch } from "../../definition/AgentSourceSearch";

/** The areas the acceptance checks, in the order of the report. */
export type CheckArea =
  | "indexing"
  | "accessSeparation"
  | "uploadDownload"
  | "sourceLinks"
  | "fallback"
  | "sourceChanges"
  | "revocation"
  | "archiving"
  | "backupRestore";

/** One verified expectation of the acceptance. */
export interface CheckResult {
  readonly area: CheckArea;
  readonly name: string;
  readonly isPassed: boolean;
  /** What was observed, without section texts. */
  readonly observed: string;
}

/** Collects the results of the checks of one area. */
export class CheckLog {
  private readonly area: CheckArea;
  private readonly results: CheckResult[];

  /**
   * Starts the log of an area.
   * @param area - The area of every result added.
   * @param results - Shared list the results are appended to.
   */
  public constructor(area: CheckArea, results: CheckResult[]) {
    this.area = area;
    this.results = results;
  }

  /**
   * Records an expectation and what was observed.
   * @param name - Expectation in one sentence.
   * @param isPassed - Whether it held.
   * @param observed - The observation.
   */
  public record(name: string, isPassed: boolean, observed: string): void {
    this.results.push({ area: this.area, name, isPassed, observed });
  }

  /**
   * Records an expectation that a step fails with a given error.
   * @param name - Expectation in one sentence.
   * @param work - The step that must fail.
   * @param isExpected - Tells whether the raised error is the expected one.
   */
  public async expectFailure(
    name: string,
    work: () => Promise<unknown>,
    isExpected: (error: unknown) => boolean,
  ): Promise<void> {
    try {
      await work();
      this.record(name, false, "succeeded");
    } catch (error: unknown) {
      this.record(name, isExpected(error), describeError(error));
    }
  }
}

/** Names an error by its class and code, without message details of the driver. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "non-error thrown";
  const code =
    "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${error.constructor.name}${code}: ${error.message}`;
}

/**
 * Lists the sources of a result as `type:reference`.
 * @param result - A search result.
 * @returns Ticket keys, page titles and asset file names in result order.
 */
export function sourcesOf(result: AgentSourceSearch): string[] {
  return result.sections.map((section) =>
    section.sourceType === "ticket"
      ? `ticket:${section.ticketKey ?? section.title}`
      : `${section.sourceType}:${section.title}`,
  );
}

/** Tells whether a result holds a section of the named source. */
export function hasSource(
  result: AgentSourceSearch,
  sourceType: "ticket" | "wiki_page" | "ticket_asset",
  reference: string,
): boolean {
  return sourcesOf(result).includes(`${sourceType}:${reference}`);
}

/** Describes a result briefly for the report. */
export function describeResult(result: AgentSourceSearch): string {
  const vector =
    result.vectorSearch.status === "used"
      ? "vector used"
      : `vector ${result.vectorSearch.reason}`;
  return `${vector}, stale ${String(result.staleSections)}, sources [${sourcesOf(result).join(", ")}]`;
}
