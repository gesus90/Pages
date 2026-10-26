import { z } from "zod";

import { logEvent } from "@/backend/logging/Logger";

const PUBLIC_FIELDS = new Set([
  "id",
  "sequence",
  "stepId",
  "attemptId",
  "turn",
  "kind",
  "createdAt",
  "text",
  "isTruncated",
  "channel",
  "history",
  "job",
  "result",
  "version",
]);

/** Safe schema facts only; neither input values nor Zod messages are retained. */
export interface RunnerSchemaIssue {
  readonly fieldPath: string;
  readonly code: string;
  readonly expectedType: string;
  readonly contractVersion: number;
}

function publicField(part: PropertyKey): string {
  if (typeof part === "number") return "[]";
  return PUBLIC_FIELDS.has(String(part)) ? String(part) : "field";
}

/** Converts validation failures to an allowlisted, value-free diagnosis. */
export function runnerSchemaIssues(
  error: unknown,
): readonly RunnerSchemaIssue[] {
  if (!(error instanceof z.ZodError))
    return [
      {
        fieldPath: "history",
        code: "checkpoint_failed",
        expectedType: "ordered_archive",
        contractVersion: 1,
      },
    ];
  return error.issues.slice(0, 8).map((issue) => ({
    fieldPath: issue.path.map(publicField).join("."),
    code: issue.code,
    expectedType: expectedType(issue),
    contractVersion: 1,
  }));
}

function expectedType(issue: z.core.$ZodIssue): string {
  if ("expected" in issue) return String(issue.expected);
  return "origin" in issue ? String(issue.origin) : "bounded_schema";
}

/** Reports field paths and contract correlation without event text or exception messages. */
export function reportRunnerSchemaIssues(
  issues: readonly RunnerSchemaIssue[],
  correlation: {
    readonly runId?: string;
    readonly attemptId?: string;
    readonly jobId: string;
  },
): void {
  for (const issue of issues)
    logEvent({
      level: "error",
      event: "runner.history.checkpoint_deferred",
      component: "RunnerHistoryRecovery",
      message:
        "History retained durably for ordered recovery; execution control remains available",
      metadata: { ...correlation, ...issue },
    });
}
