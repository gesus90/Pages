import {
  CORRELATION_ENVIRONMENT_VARIABLE,
  CORRELATION_HEADER,
  CORRELATION_ID_PATTERN,
} from "../../definition/RequestCorrelation.js";

/** Forwards only a validated trace supplied by the worker that started this bridge. */
export function correlationHeaders(): Readonly<Record<string, string>> {
  const correlationId = process.env[CORRELATION_ENVIRONMENT_VARIABLE];
  return correlationId && CORRELATION_ID_PATTERN.test(correlationId)
    ? { [CORRELATION_HEADER]: correlationId }
    : {};
}
