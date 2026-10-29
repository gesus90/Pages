import {
  isApiProvider,
  OPENCODE_FREE_PROVIDER,
  openCodeModelProvider,
} from "./AgentConnection";

import type { PageAgentModel } from "./PageAgent";

/** Pica uses CLI sessions; free Zen models require OpenCode's own tools. */
export function isPicaModel(
  model: Pick<PageAgentModel, "provider" | "model" | "isFree">,
): boolean {
  return (
    model.provider !== "antigravity" &&
    !isApiProvider(model.provider) &&
    !isPicaZenModel(model)
  );
}

/** Identifies the free Zen models excluded only from Pica, never from plans. */
export function isPicaZenModel(
  model: Pick<PageAgentModel, "provider" | "model" | "isFree">,
): boolean {
  return (
    model.provider === "opencode" &&
    openCodeModelProvider(model.model) === OPENCODE_FREE_PROVIDER &&
    model.isFree === true
  );
}
