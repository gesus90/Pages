/** Opaque credentials accepted by the Agent API and local credential store. */
export const BEARER_TOKEN_PATTERN = /^[A-Za-z0-9._~+/-]+=*$/;
/** Device-issued secrets and replacement credentials have the same format. */
export const PAIRED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** Relative to the validated Pages instance, including any base path. */
export const AGENT_API_ENDPOINT = "api/v1/agents";
/** Default budget for short reads and pairing requests. */
export const REQUEST_TIMEOUT_MS = 5_000;
/**
 * Budget of writes and of plan and workspace control. A write may wait up to
 * 25 seconds for its turn at the database, and a commit with a checkpoint took
 * up to 42 seconds, so a shorter budget would report many stored changes as
 * lost. It matches the common 60-second read timeout of a reverse proxy, beyond
 * which waiting longer gains nothing.
 */
export const WRITE_REQUEST_TIMEOUT_MS = 60_000;
/** Imports persist outcomes and may take longer than ordinary operations. */
export const IMPORT_TIMEOUT_MS = 30_000;
/** Binary uploads have an independent five-minute budget. */
export const ASSET_UPLOAD_TIMEOUT_MS = 300_000;
