import { randomUUID } from "node:crypto";

import {
  CORRELATION_ENVIRONMENT_VARIABLE,
  CORRELATION_ID_PATTERN,
} from "@/definition/RequestCorrelation";

import { currentLogContext } from "./Logger";

/** Reads one bounded wire identifier; malformed or duplicate header values start a new trace. */
export function readCorrelationId(candidate: unknown): string | undefined {
  return typeof candidate === "string" && CORRELATION_ID_PATTERN.test(candidate)
    ? candidate
    : undefined;
}

/** Passes tracing through an explicit child environment allowlist without passing request signals. */
export function correlationEnvironment(): Record<string, string> {
  return {
    [CORRELATION_ENVIRONMENT_VARIABLE]:
      currentLogContext().correlationId ?? randomUUID(),
  };
}
