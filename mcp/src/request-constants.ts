/** Opaque credentials accepted by the Agent API and local credential store. */
export const BEARER_TOKEN_PATTERN = /^[A-Za-z0-9._~+/-]+=*$/;
/** Device-issued secrets and replacement credentials have the same format. */
export const PAIRED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** Relative to the validated Pages instance, including any base path. */
export const AGENT_API_ENDPOINT = "api/v1/agents";
/** Default budget for short Agent API and pairing requests. */
export const REQUEST_TIMEOUT_MS = 5_000;
/** Imports persist outcomes and may take longer than ordinary operations. */
export const IMPORT_TIMEOUT_MS = 30_000;
/** Binary uploads have an independent five-minute budget. */
export const ASSET_UPLOAD_TIMEOUT_MS = 300_000;
