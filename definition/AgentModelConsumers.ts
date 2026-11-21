import {
  AGENT_PROVIDERS,
  OPENCODE_FREE_PROVIDER,
  openCodeModelProvider,
} from "./AgentConnection";

import { hasHostTools } from "./AgentEmployee";

import type { AgentEmployeeAccess } from "./AgentEmployee";
import type { AgentProviderId } from "./AgentConnection";
import type { PageAgentModel } from "./PageAgent";

/**
 * The places that choose a model from the shared catalog.
 * @remarks
 * Every consumer reads the same models of the same connections, and its
 * choice lists only what the consumer can run: it leaves out every model
 * refused for one of the reasons below, in the list and in the search alike.
 * The reason is worded only where a saved model has become unusable. The
 * server applies the same rules when it saves or runs a model.
 */
export type AgentModelConsumer =
  "pica" | "plan" | "employee" | "stt" | "tts" | "decision";

/**
 * Why a consumer cannot run a model.
 * - `noChatAdapter`: Pica answers only over an ACP session, and the provider
 *   registers no adapter for it, such as a direct API.
 * - `noChat`: the catalog states that the model does not chat in text or
 *   calls no tools, so Pica could neither answer nor reach its tools with it.
 * - `zenToolsMissing`: a free OpenCode Zen model needs OpenCode's own tools,
 *   which Pica's read-only session does not grant.
 * - `employeeToolsMissing`: a free OpenCode Zen model requires host tools,
 *   but the agent's access level grants only Pages tools.
 * - `noToolCalls`: the catalog states that the model calls no tools, which an
 *   agent of a plan needs.
 * - `noSpeech`: the model is not known to recognize speech, which the speech
 *   recognition of the instance needs.
 * - `noSpeechOutput`: the model is not known to speak text aloud, which the
 *   speech output of the instance needs.
 * - `speechOutputOnly`: the model speaks text aloud; it neither
 *   chats nor works on a plan node, whatever else its catalog states.
 * - `transcriptionOnly`: the model transcribes speech; it neither
 *   chats nor works on a plan node, whatever else its catalog states.
 * - `noDecision`: the model is not known to give decisions, which the decisions
 *   of group chats need.
 * - `decisionOnly`: the model gives decisions; it neither chats nor
 *   works on a plan node, whatever else its catalog states.
 */
export type ModelConsumerRefusal =
  | "noChatAdapter"
  | "noChat"
  | "zenToolsMissing"
  | "employeeToolsMissing"
  | "noToolCalls"
  | "noSpeech"
  | "noSpeechOutput"
  | "speechOutputOnly"
  | "transcriptionOnly"
  | "noDecision"
  | "decisionOnly";

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
  | "isTextCapable"
  | "isSpeechCapable"
  | "isSpeechOutputCapable"
  | "isTranscriptionOnly"
  | "isDecisionCapable"
  | "isSimulation"
>;

/**
 * Whether Pica has an ACP adapter for the provider.
 * @param provider - The provider of a connection.
 * @returns `true` when the provider registers a chat adapter.
 */
export function hasChatAdapter(
  provider: AgentProviderId,
): provider is ChatAdapterProviderId {
  return AGENT_PROVIDERS[provider].chatAdapter !== null;
}

/**
 * The providers whose adapters run a place that is not a chat or a plan.
 * @remarks
 * Speech recognition, speech output and the decisions of group chats go
 * through OpenRouter. A place without an entry
 * runs every provider's models.
 */
const PLACE_PROVIDERS: Partial<
  Record<AgentModelConsumer, readonly AgentProviderId[]>
> = {
  stt: ["openrouter"],
  tts: ["openrouter"],
  decision: ["openrouter"],
};

/**
 * Whether a place has an adapter that can run models of the provider.
 * @param consumer - The place that chooses the model.
 * @param provider - The provider of a connection.
 * @returns `false` for a connection the place could never run a model of,
 * which its choice then does not list, not even without models.
 */
export function consumerRunsProvider(
  consumer: AgentModelConsumer,
  provider: AgentProviderId,
): boolean {
  if (consumer === "pica" || consumer === "employee")
    return hasChatAdapter(provider);
  return PLACE_PROVIDERS[consumer]?.includes(provider) ?? true;
}

/**
 * Whether a model is one of the free OpenCode Zen models Pica cannot run.
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

// A speech output model, a transcription model or a
// decision model is no chat or agent model, even where its catalog
// states nothing about tools.
function speechOutputRefusal(
  model: ConsumerModel,
): ModelConsumerRefusal | null {
  if (model.isSpeechOutputCapable === true) return "speechOutputOnly";
  if (model.isDecisionCapable === true) return "decisionOnly";
  return model.isTranscriptionOnly === true ? "transcriptionOnly" : null;
}

// A model whose catalog states nothing, or whose catalog failed to refresh, stays listed.
function picaRefusal(model: ConsumerModel): ModelConsumerRefusal | null {
  if (!hasChatAdapter(model.provider)) return "noChatAdapter";
  const speechRefusal = speechOutputRefusal(model);
  if (speechRefusal !== null) return speechRefusal;
  if (model.isChatCapable === false) return "noChat";
  return isZenToolModel(model) ? "zenToolsMissing" : null;
}

// Simulated plan models keep their separate execution path.
// A model whose catalog does not say whether it calls tools stays usable: the
// adapter decides then, because an ACP session checks the Pages tool server
// before its prompt and an API request node needs no tools.
function planRefusal(model: ConsumerModel): ModelConsumerRefusal | null {
  if (model.isSimulation === true) return null;
  if (model.isToolCapable === false) return "noToolCalls";
  return (
    speechOutputRefusal(model) ??
    (model.isChatCapable === false ? "noChat" : null)
  );
}

/**
 * An agent employee answers over Pica's ACP path and works with
 * tools, so it needs both: a chat adapter and a model that calls tools. Pure
 * image, audio or other special generators never qualify.
 */
function employeeRefusal(
  model: ConsumerModel,
  context: ModelConsumerContext,
): ModelConsumerRefusal | null {
  if (!hasChatAdapter(model.provider)) return "noChatAdapter";
  if (model.isChatCapable === false) return "noChat";
  const refusal = planRefusal(model);
  if (refusal !== null) return refusal;
  return isZenToolModel(model) &&
    !hasHostTools(context.employeeAccess ?? "read_only")
    ? "employeeToolsMissing"
    : null;
}

/**
 * Speech recognition takes only a model that is known to turn
 * audio into text: a model whose catalog states audio input and
 * transcription output, or a recognition model documented in
 * Pages. A model that states nothing never qualifies, and neither does a chat
 * model that accepts audio, so chat, agent and CLI models stay out.
 */
function sttRefusal(model: ConsumerModel): ModelConsumerRefusal | null {
  return model.isSpeechCapable === true ? null : "noSpeech";
}

/**
 * Speech output takes only a model whose catalog states `speech`
 * among its outputs; chat, agent, transcription and CLI models stay out.
 */
function ttsRefusal(model: ConsumerModel): ModelConsumerRefusal | null {
  return model.isSpeechOutputCapable === true ? null : "noSpeechOutput";
}

/**
 * The decisions of group chats take only a model whose catalog
 * states `decisions` among its outputs; chat, agent, speech and CLI models
 * stay out.
 */
function decisionRefusal(model: ConsumerModel): ModelConsumerRefusal | null {
  return model.isDecisionCapable === true ? null : "noDecision";
}

/** Runtime access used by the employee rule; omitted access grants no host tools. */
export interface ModelConsumerContext {
  readonly employeeAccess?: AgentEmployeeAccess;
}

const CONSUMER_RULES: Readonly<
  Record<
    AgentModelConsumer,
    (
      model: ConsumerModel,
      context: ModelConsumerContext,
    ) => ModelConsumerRefusal | null
  >
> = {
  pica: picaRefusal,
  plan: planRefusal,
  employee: employeeRefusal,
  stt: sttRefusal,
  tts: ttsRefusal,
  decision: decisionRefusal,
};

/**
 * Why a consumer cannot run a model of the shared catalog.
 * @remarks
 * These rules are the only place where Pica and plans differ in their
 * models. A provider that registers a chat adapter in
 * {@link AGENT_PROVIDERS} releases its models for Pica without any change to
 * a model choice. The server applies the same rules before it saves
 * or runs a model. The choice lists no refused model and names the reason only
 * for a saved one; a listed model is no grant of use.
 * @param consumer - The place that chooses the model.
 * @param model - Provider, model ID and catalog traits of the model.
 * @param context - Access level of an agent employee.
 * @returns The reason, or `null` when the consumer can run the model.
 */
export function modelConsumerRefusal(
  consumer: AgentModelConsumer,
  model: ConsumerModel,
  context: ModelConsumerContext = {},
): ModelConsumerRefusal | null {
  return CONSUMER_RULES[consumer](model, context);
}

/**
 * Keeps the models a consumer can run.
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
