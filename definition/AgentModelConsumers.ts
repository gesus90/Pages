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
export type AgentModelConsumer = "pica" | "plan" | "employee" | "stt" | "tts";

/**
 * Why a consumer cannot run a model.
 *
 * - `noChatAdapter`: Pica answers only over an ACP session, and the provider
 *   registers no adapter for it, such as a direct API.
 * - `noChat`: the catalog states that the model does not chat in text or
 *   calls no tools, so Pica could neither answer nor reach its tools with it.
 * - `zenToolsMissing`: a free OpenCode Zen model needs OpenCode's own tools,
 *   which Pica's read-only session does not grant.
 * - `noToolCalls`: the catalog states that the model calls no tools, which an
 *   agent of a plan needs.
 * - `noSpeech`: the model is not known to recognize speech, which the speech
 *   recognition of the instance (PAGE-273) needs.
 * - `noSpeechOutput`: the model is not known to speak text aloud, which the
 *   speech output of the instance (PAGE-300) needs.
 * - `speechOutputOnly`: the model speaks text aloud (PAGE-300); it neither
 *   chats nor works on a plan node, whatever else its catalog states.
 */
export type ModelConsumerRefusal =
  | "noChatAdapter"
  | "noChat"
  | "zenToolsMissing"
  | "noToolCalls"
  | "noSpeech"
  | "noSpeechOutput"
  | "speechOutputOnly";

/** The providers Pica has an ACP adapter for, as registered in {@link AGENT_PROVIDERS}. */
export type ChatAdapterProviderId = {
  [
    Id in AgentProviderId
  ]: (typeof AGENT_PROVIDERS)[Id]["chatAdapter"] extends null ? never : Id;
}[AgentProviderId];

type ConsumerModel = Pick<
  PageAgentModel,
  | "provider"
  | "model"
  | "isFree"
  | "isToolCapable"
  | "isChatCapable"
  | "isSpeechCapable"
  | "isSpeechOutputCapable"
>;

/**
 * Whether Pica has an ACP adapter for the provider.
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

// A speech output model (PAGE-300) is no chat or agent model, even where its catalog states no tools.
function speechOutputRefusal(
  model: ConsumerModel,
): ModelConsumerRefusal | null {
  return model.isSpeechOutputCapable === true ? "speechOutputOnly" : null;
}

// A model whose catalog states nothing, or whose catalog failed to refresh, stays listed.
function picaRefusal(model: ConsumerModel): ModelConsumerRefusal | null {
  if (!hasChatAdapter(model.provider)) return "noChatAdapter";
  if (model.isSpeechOutputCapable === true) return "speechOutputOnly";
  if (model.isChatCapable === false) return "noChat";
  return isZenToolModel(model) ? "zenToolsMissing" : null;
}

// A model whose catalog does not say whether it calls tools stays listed.
function planRefusal(model: ConsumerModel): ModelConsumerRefusal | null {
  if (model.isToolCapable === false) return "noToolCalls";
  return speechOutputRefusal(model);
}

/**
 * An agent employee (PAGE-266) answers over Pica's ACP path and works with
 * tools, so it needs both: a chat adapter and a model that calls tools. Pure
 * image, audio or other special generators never qualify.
 */
function employeeRefusal(model: ConsumerModel): ModelConsumerRefusal | null {
  return picaRefusal(model) ?? planRefusal(model);
}

/**
 * Speech recognition (PAGE-273) takes only a model that is known to turn
 * audio into text: a model whose catalog states audio input and
 * transcription output (PAGE-294), or a recognition model documented in
 * Pages. A model that states nothing never qualifies, and neither does a chat
 * model that accepts audio, so chat, agent and CLI models stay out.
 */
function sttRefusal(model: ConsumerModel): ModelConsumerRefusal | null {
  return model.isSpeechCapable === true ? null : "noSpeech";
}

/**
 * Speech output (PAGE-300) takes only a model whose catalog states `speech`
 * among its outputs; chat, agent, transcription and CLI models stay out.
 */
function ttsRefusal(model: ConsumerModel): ModelConsumerRefusal | null {
  return model.isSpeechOutputCapable === true ? null : "noSpeechOutput";
}

const CONSUMER_RULES: Readonly<
  Record<
    AgentModelConsumer,
    (model: ConsumerModel) => ModelConsumerRefusal | null
  >
> = {
  pica: picaRefusal,
  plan: planRefusal,
  employee: employeeRefusal,
  stt: sttRefusal,
  tts: ttsRefusal,
};

/**
 * Why a consumer cannot run a model of the shared catalog.
 *
 * @remarks
 * These rules are the only place where Pica and plans differ in their
 * models. A provider that registers a chat adapter in
 * {@link AGENT_PROVIDERS} releases its models for Pica without any change to
 * a model choice. The server applies the same rules before it lists, saves
 * or runs a model, and a model choice lists only the models without a
 * refusal; a listed model is no grant of use.
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
