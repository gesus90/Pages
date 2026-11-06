/** HTTP field used only for tracing internal calls, never for authorization. */
export const CORRELATION_HEADER = "X-Correlation-ID";

/** Process environment field inherited by agents, scripts and their MCP bridge. */
export const CORRELATION_ENVIRONMENT_VARIABLE = "PAGES_CORRELATION_ID";

/** Bounded, single identifiers; lists, whitespace and control characters are rejected. */
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
