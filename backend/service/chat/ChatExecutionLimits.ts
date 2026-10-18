/** Actual Pages tool executions per agent turn, shared by API, ACP and legacy actions. */
export const CHAT_MAXIMUM_ACTIONS = 256;

/** 256 single-tool model steps, one possible refusal, and a final text answer. */
export const CHAT_MAXIMUM_MODEL_STEPS = CHAT_MAXIMUM_ACTIONS + 2;

/**
 * Overall chat deadline: 256 model/tool cycles at 20 seconds plus 280 seconds
 * for startup and the final answer. Explicit shorter ACP agent limits still apply.
 * Follow-up turns share this finite job deadline; steering never extends it.
 */
export const CHAT_REQUEST_TIMEOUT_MS = 90 * 60_000;
