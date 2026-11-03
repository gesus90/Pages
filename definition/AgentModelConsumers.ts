import {
  AGENT_PROVIDERS,
  OPENCODE_FREE_PROVIDER,
  openCodeModelProvider,
} from "./AgentConnection";

import type { AgentProviderId } from "./AgentConnection";
import type { PageAgentModel } from "./PageAgent";

/**
 * The places that choose a model from the shared catalog.
 *
 * @remarks
 * Every consumer reads the same models of the same connections; it only
 * leaves out what it cannot run, for one of the reasons below.
 */
export type AgentModelConsumer = "pica" | "plan";

/**
 * Why a consumer cannot run a model.
 *
 * - `noChatAdapter`: Pica answers only over an ACP session, and the provider
 *   registers no adapter for it, such as a direct API.
 * - `chatAdapterUnverified`: the provider's ACP adapter exists, but its tools
 *   are not yet verified for Pica.
 * - `zenToolsMissing`: a free OpenCode Zen model needs OpenCode's own tools,
 *   which Pica's read-only session does not grant.
 * - `noToolCalls`: the catalog states that the model calls no tools, which an
 *   agent of a plan needs.
 */
export type ModelConsumerRefusal =
  "noChatAdapter" | "chatAdapterUnverified" | "zenToolsMissing" | "noToolCalls";

/** The providers Pica has an ACP adapter for, verified or not, as registered in {@link AGENT_PROVIDERS}. */
export type ChatAdapterProviderId = {
  [
    Id in AgentProviderId
  ]: (typeof AGENT_PROVIDERS)[Id]["chatAdapter"] extends null ? never : Id;
}[AgentProviderId];

type ConsumerModel = Pick<
  PageAgentModel,
  "provider" | "model" | "isFree" | "isToolCapable"
>;

/**
 * Whether Pica has an ACP adapter for the provider, verified or not.
 *
 * @param provider - The provider of a connection.
 * @returns `true` when the provider registers a chat adapter.
 */
export function hasChatAdapter(
  provider: AgentProviderId,
): provider is ChatAdapterProviderId {
  return AGENT_PROVIDERS[provider].chatAdapter !== null;
}

/**
 * Whether a model is one of the free OpenCode Zen models Pica cannot run.
 *
 * @param model - Provider, model ID and free mark of a catalog model.
 * @returns `true` for a free model of OpenCode's own provider; plans keep it.
 */
export function isZenToolModel(
  model: Pick<ConsumerModel, "provider" | "model" | "isFree">,
): boolean {
  return (
    model.provider === "opencode" &&
    openCodeModelProvider(model.model) === OPENCODE_FREE_PROVIDER &&
    model.isFree === true
  );
}

function picaRefusal(model: ConsumerModel): ModelConsumerRefusal | null {
  const adapter = AGENT_PROVIDERS[model.provider].chatAdapter;
  if (adapter === null) return "noChatAdapter";
  if (adapter === "unverified") return "chatAdapterUnverified";
  return isZenToolModel(model) ? "zenToolsMissing" : null;
}

// A model whose catalog does not say whether it calls tools stays listed.
function planRefusal(model: ConsumerModel): ModelConsumerRefusal | null {
  return model.isToolCapable === false ? "noToolCalls" : null;
}

const CONSUMER_RULES: Readonly<
  Record<
    AgentModelConsumer,
    (model: ConsumerModel) => ModelConsumerRefusal | null
  >
> = {
  pica: picaRefusal,
  plan: planRefusal,
};

/**
 * Why a consumer cannot run a model of the shared catalog.
 *
 * @remarks
 * These rules are the only place where Pica and plans differ in their
 * models. A provider that registers a verified chat adapter in
 * {@link AGENT_PROVIDERS} releases its models for Pica without any change to
 * a model choice. The server applies the same rules before it lists, saves
 * or runs a model; a listed model is no grant of use.
 *
 * @param consumer - The place that chooses the model.
 * @param model - Provider, model ID and catalog traits of the model.
 * @returns The reason, or `null` when the consumer can run the model.
 */
export function modelConsumerRefusal(
  consumer: AgentModelConsumer,
  model: ConsumerModel,
): ModelConsumerRefusal | null {
  return CONSUMER_RULES[consumer](model);
}

/**
 * Keeps the models a consumer can run.
 *
 * @param consumer - The place that chooses the model.
 * @param models - Models of the shared catalog.
 * @returns The models without a refusal, in their order.
 */
export function consumerModels<Model extends ConsumerModel>(
  consumer: AgentModelConsumer,
  models: readonly Model[],
): Model[] {
  return models.filter(
    (model) => modelConsumerRefusal(consumer, model) === null,
  );
}
