import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentConnectionScope } from "./AgentConnectionScope";

/** API keys and CLI accounts remain separate connection types. */
export type ApiProviderId =
  "openrouter" | "openai" | "google_ai_studio" | "anthropic";
export type CliProviderId =
  "codex_cli" | "claude_code" | "opencode" | "antigravity";
export type AgentProviderId = ApiProviderId | CliProviderId;
export type AgentAccessKind = "api_key" | "cli_account";
export type AgentCheckKind = "auth" | "model";

/**
 * Provider IDs Pages no longer offers.
 * @remarks
 * Stored connections, saved model choices and finished sessions of such a
 * provider stay in the database. They are recognised only to keep old data
 * readable: a retired provider is never listed, selected or run.
 */
export const RETIRED_PROVIDER_IDS = ["zai"] as const;
export type RetiredProviderId = (typeof RETIRED_PROVIDER_IDS)[number];

/** Whether a stored provider ID names a provider Pages retired. */
export function isRetiredProviderId(
  value: unknown,
): value is RetiredProviderId {
  return RETIRED_PROVIDER_IDS.some((retired) => retired === value);
}

/**
 * The native OpenCode provider IDs of a retired provider.
 * @remarks
 * OpenCode ships these providers itself. Their models are neither listed nor
 * run, even when OpenCode still reports them. The Z.AI Coding Plan
 * (`zai-coding-plan`) is no retired provider: only a connection that stores
 * its own subscription key for it offers its models, see {@link ZAI_CODING_PLAN_PROVIDER}.
 */
const RETIRED_OPENCODE_PROVIDERS: readonly string[] = [
  "zai",
  "zhipuai",
  "zhipuai-coding-plan",
];

/** OpenCode's native provider of the Z.AI Coding Plan subscription. */
export const ZAI_CODING_PLAN_PROVIDER = "zai-coding-plan";

/**
 * Whether a full OpenCode model ID belongs to a retired native provider.
 * @param model - A model ID such as `provider/model`.
 */
export function isRetiredOpenCodeModel(model: string): boolean {
  return RETIRED_OPENCODE_PROVIDERS.includes(model.split("/")[0]);
}

/**
 * The runner an earlier session of a retired provider ran on.
 * @param provider - A stored provider or runner ID.
 * @returns `opencode` for a retired provider, which ran on the native OpenCode
 * session, and the unchanged ID otherwise. History stays readable without the
 * retired provider's brand.
 */
export function historicalRunnerOf(provider: string): string {
  return isRetiredProviderId(provider) ? "opencode" : provider;
}

/**
 * Native OpenCode key destinations in the order the key form offers them.
 * @remarks
 * A Zen key must never be assigned to OpenRouter, and a Coding Plan key
 * never to the regular Z.AI API, which stays retired.
 */
export const OPENCODE_KEY_PROVIDERS = [
  "opencode",
  "openrouter",
  ZAI_CODING_PLAN_PROVIDER,
] as const;
export type OpenCodeKeyProvider = (typeof OPENCODE_KEY_PROVIDERS)[number];

/** Validates an explicitly selected key destination, without guessing from the key. */
export function isOpenCodeKeyProvider(
  input: unknown,
): input is OpenCodeKeyProvider {
  return OPENCODE_KEY_PROVIDERS.some((provider) => provider === input);
}

/** Legacy native provider names and the ordering of API connection choices. */
export const OPENCODE_LINKED_PROVIDERS = {
  google_ai_studio: "google",
  openrouter: "openrouter",
} as const;
export type OpenCodeLinkedProvider = keyof typeof OPENCODE_LINKED_PROVIDERS;

/** OpenCode's own provider, whose free models need no key. */
export const OPENCODE_FREE_PROVIDER = "opencode";

/** Whether an API connection belongs to the legacy provider ordering. */
export function isOpenCodeLinkedProvider(
  provider: AgentProviderId,
): provider is OpenCodeLinkedProvider {
  return Object.hasOwn(OPENCODE_LINKED_PROVIDERS, provider);
}

/** Legacy mapping of native OpenCode provider IDs to Pages API providers. */
export function linkedApiProviderOf(
  modelProvider: string,
): OpenCodeLinkedProvider | null {
  for (const [provider, native] of Object.entries(OPENCODE_LINKED_PROVIDERS))
    if (
      native === modelProvider &&
      isAgentProvider(provider) &&
      isOpenCodeLinkedProvider(provider)
    )
      return provider;
  return null;
}

/** Legacy native key destination of a linked API connection. */
export function openCodeLinkedModelProvider(connection: {
  readonly provider: OpenCodeLinkedProvider;
}): string {
  return OPENCODE_LINKED_PROVIDERS[connection.provider];
}

/** The native provider of a full OpenCode model ID such as `google/gemini-3.8-flash`. */
export function openCodeModelProvider(model: string): string {
  return model.split("/")[0];
}

/**
 * Whether a full OpenCode model ID belongs to the Z.AI Coding Plan.
 * @param model - A model ID such as `zai-coding-plan/glm-5.1`.
 */
export function isZaiCodingPlanModel(model: string): boolean {
  return openCodeModelProvider(model) === ZAI_CODING_PLAN_PROVIDER;
}

/**
 * The provider group of the Z.AI Coding Plan in a model choice.
 * @remarks
 * The subscription runs through an OpenCode connection, but a model choice
 * lists it as a provider of its own beside OpenCode and OpenRouter.
 */
export const ZAI_CODING_PLAN_GROUP = "zai_coding_plan";

/**
 * The provider group a model stands under in a model choice.
 * @remarks
 * Every provider is its own group. The Z.AI Coding Plan is the one group that
 * is no provider: its connection is an OpenCode connection with a
 * subscription key.
 */
export type ModelProviderGroup = AgentProviderId | typeof ZAI_CODING_PLAN_GROUP;

/** Narrows an untrusted group identifier to the known provider groups. */
export function isModelProviderGroup(
  value: unknown,
): value is ModelProviderGroup {
  return value === ZAI_CODING_PLAN_GROUP || isAgentProvider(value);
}

/**
 * The provider group of one model of a connection.
 * @param provider - The provider of the model's connection.
 * @param model - The full model ID, such as `zai-coding-plan/glm-5.1`.
 * @returns The Z.AI Coding Plan group for a `zai-coding-plan/` model of an
 * OpenCode connection, otherwise the provider itself.
 */
export function modelProviderGroup(
  provider: AgentProviderId,
  model: string,
): ModelProviderGroup {
  return provider === "opencode" && isZaiCodingPlanModel(model)
    ? ZAI_CODING_PLAN_GROUP
    : provider;
}

/**
 * The provider group of a connection, also of one that lists no model.
 * @param connection - Provider and stored native key provider of the connection.
 * @returns The Z.AI Coding Plan group for an OpenCode connection that stores
 * a Coding Plan key, otherwise the provider itself.
 */
export function connectionProviderGroup(connection: {
  readonly provider: AgentProviderId;
  readonly cliAccountLabel: string | null;
}): ModelProviderGroup {
  return connection.provider === "opencode" &&
    connection.cliAccountLabel === ZAI_CODING_PLAN_PROVIDER
    ? ZAI_CODING_PLAN_GROUP
    : connection.provider;
}

/**
 * Whether a model is an OpenCode Zen model its catalog proves free.
 * @param model - The full model ID and whether the catalog states a price of zero.
 * @returns `false` for a model of another native provider and for a model
 * with a price or without a stated price.
 */
export function isFreeOpenCodeZenModel(model: {
  readonly id: string;
  readonly isFree?: boolean;
}): boolean {
  return (
    openCodeModelProvider(model.id) === OPENCODE_FREE_PROVIDER &&
    model.isFree === true
  );
}

/**
 * Why an OpenCode connection neither offers nor runs a model.
 * - `codingPlanOnly`: the connection stores a Z.AI Coding Plan key and runs
 *   only `zai-coding-plan/` models.
 * - `codingPlanKeyMissing`: the model belongs to the Z.AI Coding Plan, but the
 *   connection stores no key of that subscription.
 * - `notFree`: the model is no OpenCode Zen model its catalog proves free; it
 *   has a price, states none or belongs to another native provider.
 */
export type OpenCodeModelRefusal =
  "codingPlanOnly" | "codingPlanKeyMissing" | "notFree";

/**
 * Why a connection neither offers nor runs a model of its catalog.
 * @param connection - Provider and stored native key provider of the connection.
 * @param model - The full model ID and whether the catalog proves it free.
 * @returns The reason for an OpenCode connection; `null` for an admitted
 * model and for every other provider.
 * @remarks
 * A connection that stores a Z.AI Coding Plan key admits only
 * `zai-coding-plan/` models. Every other OpenCode connection admits only the
 * OpenCode Zen models its catalog proves free, whatever key it stores, so no
 * selection reaches a model with a price or an unknown price.
 */
export function openCodeModelRefusal(
  connection: {
    readonly provider: AgentProviderId;
    readonly cliAccountLabel: string | null;
  },
  model: { readonly id: string; readonly isFree?: boolean },
): OpenCodeModelRefusal | null {
  if (connection.provider !== "opencode") return null;
  const isCodingPlanModel = isZaiCodingPlanModel(model.id);
  if (connection.cliAccountLabel === ZAI_CODING_PLAN_PROVIDER)
    return isCodingPlanModel ? null : "codingPlanOnly";
  if (isCodingPlanModel) return "codingPlanKeyMissing";
  return isFreeOpenCodeZenModel(model) ? null : "notFree";
}

/**
 * Whether a connection offers and may run a model of its catalog.
 * @param connection - Provider and stored native key provider of the connection.
 * @param model - The full model ID and whether the catalog proves it free.
 * @returns For OpenCode connections: a connection that stores a Z.AI Coding
 * Plan key admits only `zai-coding-plan/` models, every other one only the
 * free models of OpenCode's own provider. Any other provider admits all.
 * @remarks
 * The model choice and the start of a session apply this one rule, so
 * neither lists nor runs a model of a provider the connection holds no key
 * for. {@link openCodeModelRefusal} names the reason of a refusal.
 */
export function isOpenCodeConnectionModel(
  connection: {
    readonly provider: AgentProviderId;
    readonly cliAccountLabel: string | null;
  },
  model: { readonly id: string; readonly isFree?: boolean },
): boolean {
  return openCodeModelRefusal(connection, model) === null;
}

/** Where a connection runs, in the order a model choice lists them. */
export const AGENT_CONNECTION_LOCATIONS = ["local", "remote"] as const;
export type AgentConnectionLocation =
  (typeof AGENT_CONNECTION_LOCATIONS)[number];

/**
 * Fixed endpoints prevent administrators from redirecting saved credentials.
 * @remarks
 * `location` says where Pages runs the connection. Pages starts every current
 * provider on this host, a CLI as a local process and an API as a request of
 * the server, so all are local; connections on another machine are remote.
 * `vendor` names the provider whose models a connection offers, so a CLI
 * subscription is listed together with the API of its vendor.
 * Every model choice reads a provider's appearance and abilities here, so a
 * runner is registered once: `mark` names its brand mark in the model choice
 * (a key without a drawn mark shows the neutral fallback), and `chatAdapter`
 * says how Pica answers with it: `acp` over an ACP session that reaches only
 * Pica's tools, and `null` for a provider Pica has no adapter for, such as a
 * direct API. OpenRouter answers over the ACP session of Pages' private
 * OpenCode runtime, which receives only the key of its own connection, like a
 * plan node of OpenRouter does.
 */
export const AGENT_PROVIDERS = {
  openrouter: {
    accessKind: "api_key",
    labelKey: "settings.agents.provider.openrouter",
    location: "local",
    vendor: "openrouter",
    endpoint: "https://openrouter.ai/api/v1",
    mark: "openrouter",
    chatAdapter: "acp",
  },
  openai: {
    accessKind: "api_key",
    labelKey: "settings.agents.provider.openai",
    location: "local",
    vendor: "openai",
    endpoint: "https://api.openai.com/v1",
    mark: "openai",
    chatAdapter: null,
  },
  google_ai_studio: {
    accessKind: "api_key",
    labelKey: "settings.agents.provider.google_ai_studio",
    location: "local",
    vendor: "google_ai_studio",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    mark: "gemini",
    chatAdapter: null,
  },
  anthropic: {
    accessKind: "api_key",
    labelKey: "settings.agents.provider.anthropic",
    location: "local",
    vendor: "anthropic",
    endpoint: "https://api.anthropic.com/v1",
    mark: "anthropic",
    chatAdapter: null,
  },
  codex_cli: {
    accessKind: "cli_account",
    labelKey: "settings.agents.provider.codex_cli",
    location: "local",
    vendor: "openai",
    mark: "openai",
    chatAdapter: "acp",
  },
  claude_code: {
    accessKind: "cli_account",
    labelKey: "settings.agents.provider.claude_code",
    location: "local",
    vendor: "anthropic",
    mark: "claude",
    chatAdapter: "acp",
  },
  antigravity: {
    accessKind: "cli_account",
    labelKey: "settings.agents.provider.antigravity",
    location: "local",
    vendor: "google_ai_studio",
    mark: "antigravity",
    chatAdapter: "acp",
  },
  opencode: {
    accessKind: "cli_account",
    labelKey: "settings.agents.provider.opencode",
    location: "local",
    vendor: "opencode",
    mark: "opencode",
    chatAdapter: "acp",
  },
} as const;

export const MODEL_TEST_PROMPT = "Reply with exactly: OK";

/** Credentials may only be sent to the fixed endpoint of the provider. */
export function apiProviderEndpoint(provider: ApiProviderId): string {
  return AGENT_PROVIDERS[provider].endpoint;
}

/** Narrows untrusted provider identifiers to the fixed catalog. */
export function isAgentProvider(value: unknown): value is AgentProviderId {
  return typeof value === "string" && Object.hasOwn(AGENT_PROVIDERS, value);
}

/** Distinguishes API providers without treating a CLI account as an API key. */
export function isApiProvider(
  provider: AgentProviderId,
): provider is ApiProviderId {
  return AGENT_PROVIDERS[provider].accessKind === "api_key";
}

/** Only these non-secret measurements may be persisted or returned. */
export interface AgentCheckDetail {
  readonly modelCount?: number;
  readonly hasMoreModels?: boolean;
  readonly limitRemaining?: number;
  readonly isFreeTier?: boolean;
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly endpoint?: string;
  readonly cliVersion?: string;
  readonly authMethod?:
    "chatgpt" | "claude.ai" | "openrouter" | "oauth-personal";
  /** Native OpenCode model provider, independent of the Pages runner ID. */
  readonly modelProvider?: string;
  /** Reasoning effort the model or CLI test requested, if one was configured. */
  readonly reasoningEffort?: string;
  /** Reported accounting cost, not an additional subscription charge. */
  readonly costUsd?: number;
}

export interface AgentCheckSummary {
  readonly status: "passed" | "failed";
  readonly errorCode: AgentErrorCode | null;
  readonly checkedAt: string;
  readonly durationMs: number;
  readonly detail: AgentCheckDetail;
}

export type CliLoginState =
  | "starting"
  | "awaiting_user"
  | "verifying"
  | "succeeded"
  | "failed"
  | "expired"
  | "cancelled";

/**
 * Ephemeral session view.
 * @remarks
 * Only the protected login resource returns `verificationUrl` and `userCode`,
 * and only to the administrator who started the login.
 */
export interface CliLoginView {
  readonly state: CliLoginState;
  readonly verificationUrl?: string;
  readonly userCode?: string;
  readonly expiresAt?: string;
  readonly errorCode?: AgentErrorCode;
  /** Whether the reading administrator started this login. */
  readonly isOwnLogin?: boolean;
  /** The provider redirect can be completed by pasting the browser's address. */
  readonly canSubmitRedirect?: boolean;
}

/** Whether polling and the login operation lock should remain active. */
export function isLoginActive(state: CliLoginState): boolean {
  return (
    state === "starting" || state === "awaiting_user" || state === "verifying"
  );
}

export interface AgentCliState {
  /** The account is supplied by the operator and cannot be changed from Pages. */
  readonly isOperatorBound?: boolean;
  readonly binaryFound: boolean;
  readonly loggedInAt: string | null;
  readonly accountLabel: string | null;
  readonly login: CliLoginView | null;
  /** Isolated command for the service user; contains no credentials. */
  readonly terminalCommand: string;
}

/** Safe metadata; neither ciphertext nor key fragments belong in this contract. */
export interface AgentConnectionSummary {
  /** Codex model ID to public OpenRouter price ID; administrator-only metadata. */
  readonly codexPriceMappings?: Readonly<Record<string, string>>;
  readonly claudePriceModels?: Readonly<Record<string, string>>;
  readonly isActive: boolean;
  readonly id: string;
  readonly name: string;
  readonly provider: AgentProviderId;
  readonly accessKind: AgentAccessKind;
  readonly hasApiKey: boolean;
  readonly testModel: string | null;
  /** Saved effort for the selected model; null keeps the provider or CLI default. */
  readonly reasoningEffort: string | null;
  /** Who may use the models of this connection; administrators only receive it. */
  readonly scope: AgentConnectionScope;
  readonly cli: AgentCliState | null;
  /** Administrator-chosen OpenRouter IDs for ambiguous OpenCode models. */
  readonly openRouterModelIds?: Readonly<Record<string, string>>;
  readonly checks: {
    readonly auth: AgentCheckSummary | null;
    readonly model: AgentCheckSummary | null;
  };
  readonly updatedAt: string;
}

/**
 * Whether an OpenCode connection holds a Z.AI Coding Plan subscription key.
 * @param connection - The connection as the administration shows it.
 * @returns `true` when the stored native provider or the saved test model names
 * the Coding Plan. The test model keeps the connection recognizable after a
 * rejected key cleared its stored provider.
 */
export function isZaiCodingPlanConnection(
  connection: Pick<AgentConnectionSummary, "provider" | "cli" | "testModel">,
): boolean {
  return (
    connection.provider === "opencode" &&
    (connection.cli?.accountLabel === ZAI_CODING_PLAN_PROVIDER ||
      connection.testModel?.startsWith(`${ZAI_CODING_PLAN_PROVIDER}/`) === true)
  );
}

export interface AgentConnectionInput {
  readonly codexPriceMappings?: unknown;
  readonly claudePriceModels?: unknown;
  readonly name: string;
  readonly provider?: string;
  readonly apiKey?: string;
  readonly openRouterManagementKey?: string | null;
  readonly testModel?: string;
  readonly reasoningEffort?: string;
  /** Untrusted JSON mapping, validated before persistence. */
  readonly openRouterModelIds?: unknown;
  /**
   * Untrusted usage scope from the request, validated by the service.
   * @remarks
   * Absent means global on creation and unchanged on update.
   */
  readonly scope?: unknown;
}

export interface CliToolLocation {
  readonly found: boolean;
  readonly path: string | null;
}

export type CliToolLocations = Readonly<Record<CliProviderId, CliToolLocation>>;
