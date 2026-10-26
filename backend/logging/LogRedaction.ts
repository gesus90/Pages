const REDACTED = "[REDACTED]";
const MAXIMUM_TEXT = 4_000;
const SECRET_KEY =
  /password|passwd|secret|token|cookie|authorization|credential|private.?key|api.?key|session.?key/iu;
const CONTENT_KEY =
  /^(?:body|prompt|content|text|input|output|response|headers|parameters|attachment|environment|env)$/iu;
const SAFE_METADATA_KEY =
  /^(?:fieldPath|expectedType|contractVersion|connectionId|stepId|runnerSessionId|requestId|correlationId|runId|jobId|attemptId|sessionId|userId|projectId|ticketId|pageId|agentId|toolId|operation|method|route|status|statusCode|durationMs|count|deleted|failed|retentionDays|timeZone|port|code|reason|kind|sequence|bytes|signal|exitCode|isConfirmed|leftovers|parameterCount|statementId|rows|pending|lost|truncated|source|eventType|provider|databaseQueries|databaseTotalMs|databaseSlowestMs|databaseSlowestStatementId|databaseSlowestOperation|databaseTransactionsCommitted|databaseTransactionsRolledBack|routeLoaders|routeActions|routeHandlersCompleted|routeHandlersFailed|routeHandlerTotalMs|routeHandlerSlowestMs|routeHandlerSlowest)$/u;
const registeredSecrets = new Set<string>();

/** Remembers an instance secret without ever including it in an event. */
export function registerLogSecret(secret: string): void {
  if (secret.length >= 4 && registeredSecrets.size < 256)
    registeredSecrets.add(secret);
}

/** Redacts known secrets and common credential syntax before any destination. */
export function redactLogText(text: string): string {
  let safe = text
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/giu,
      REDACTED,
    )
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/giu, REDACTED)
    .replace(
      /\b(?:set-cookie|cookie|authorization)["']?\s*[:=]\s*[^\r\n]+/giu,
      REDACTED,
    )
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/gu, REDACTED)
    .replace(
      /\b(?:gh[pousr]_[\w]+|github_pat_[\w]+|sk-[\w-]{8,}|xox[baprs]-[\w-]+)/gu,
      REDACTED,
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/giu, `$1${REDACTED}@`)
    .replace(/([?&][^\s=&#]+)=([^\s&#]*)/gu, `$1=${REDACTED}`)
    .replace(
      /((?:[\w-]*(?:password|passwd|secret|token|cookie|authorization|credential|private[_-]?key|api[_-]?key)[\w-]*)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/giu,
      `$1${REDACTED}`,
    );
  for (const secret of registeredSecrets)
    safe = safe.replaceAll(secret, REDACTED);
  for (const [key, secret] of Object.entries(process.env)) {
    if (SECRET_KEY.test(key) && secret && secret.length >= 4)
      safe = safe.replaceAll(secret, REDACTED);
  }
  return safe.length > MAXIMUM_TEXT
    ? `${safe.slice(0, MAXIMUM_TEXT)}[TRUNCATED]`
    : safe;
}

/** Allowlists primitive operational metadata; arbitrary objects and user content never pass. */
export function safeLogMetadata(
  input: Readonly<Record<string, unknown>> = {},
): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  let count = 0;
  for (const key of Object.keys(input)) {
    if (++count > 32) {
      safe.truncated = true;
      break;
    }
    if (SECRET_KEY.test(key) || CONTENT_KEY.test(key)) {
      safe.truncated = true;
      continue;
    }
    if (!SAFE_METADATA_KEY.test(key)) {
      safe.truncated = true;
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    const candidate: unknown = descriptor?.value;
    if (typeof candidate === "string")
      safe[key] = redactLogText(candidate).slice(0, 256);
    else if (typeof candidate === "boolean" || candidate === null)
      safe[key] = candidate;
    else if (typeof candidate === "number" && Number.isFinite(candidate))
      safe[key] = candidate;
    else safe.truncated = true;
    if (typeof candidate === "string" && candidate.length > 256)
      safe.truncated = true;
  }
  return safe;
}
