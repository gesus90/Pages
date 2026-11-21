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
 * run, even when OpenCode still reports them.
 */
const RETIRED_OPENCODE_PROVIDERS: readonly string[] = [
  "zai",
  "zai-coding-plan",
  "zhipuai",
  "zhipuai-coding-plan",
];

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

/** Native OpenCode key destinations; a Zen key must never be assigned to OpenRouter. */
export const OPENCODE_KEY_PROVIDERS = ["opencode", "openrouter"] as const;
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
 * direct API.
 */
export const AGENT_PROVIDERS = {
  openrouter: {
    accessKind: "api_key",
    labelKey: "settings.agents.provider.openrouter",
    location: "local",
    vendor: "openrouter",
    endpoint: "https://openrouter.ai/api/v1",
    mark: "openrouter",
    chatAdapter: null,
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
