import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentConnectionScope } from "./AgentConnectionScope";

/** API keys and CLI accounts remain separate connection types. */
export type ApiProviderId =
  "openrouter" | "openai" | "google_ai_studio" | "zai" | "anthropic";
export type CliProviderId = "codex_cli" | "claude_code" | "opencode";
export type AgentProviderId = ApiProviderId | CliProviderId;
export type AgentAccessKind = "api_key" | "cli_account";
export type AgentCheckKind = "auth" | "model";

/** The subscription and prepaid APIs use separate fixed endpoints and OpenCode providers. */
export type ZaiAccountType = "api" | "coding-plan";

/** Validates an explicit account choice without inspecting credentials. */
export function isZaiAccountType(input: unknown): input is ZaiAccountType {
  return input === "api" || input === "coding-plan";
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

/**
 * API providers whose key in Pages OpenCode receives automatically, with the
 * native OpenCode provider ID, in the order the provider choice lists them.
 *
 * @remarks
 * The key stays stored once, with its API connection; an OpenCode process
 * gets it only in its own environment and only for a model of that provider.
 */
export const OPENCODE_LINKED_PROVIDERS = {
  zai: "zai",
  google_ai_studio: "google",
  openrouter: "openrouter",
} as const;
export type OpenCodeLinkedProvider = keyof typeof OPENCODE_LINKED_PROVIDERS;

/**
 * Whether OpenCode receives the key of one linked provider.
 *
 * @remarks
 * `linked`: an active key whose access check passed; `auth_failed`: the
 * check rejected the key; `unchecked`: no check result yet; `missing`: Pages
 * holds no active key for the provider.
 */
export interface OpenCodeProviderLink {
  readonly provider: OpenCodeLinkedProvider;
  /** The native OpenCode provider ID, such as `google`. */
  readonly modelProvider: string;
  readonly state: "linked" | "auth_failed" | "unchecked" | "missing";
  readonly connectionId: string | null;
  readonly connectionName: string | null;
}

/** OpenCode's own provider, whose free models need no key. */
export const OPENCODE_FREE_PROVIDER = "opencode";

/** Whether OpenCode receives the key of this API provider. */
export function isOpenCodeLinkedProvider(
  provider: AgentProviderId,
): provider is OpenCodeLinkedProvider {
  return Object.hasOwn(OPENCODE_LINKED_PROVIDERS, provider);
}

/** The API provider whose key a native OpenCode provider uses, if Pages links one. */
export function linkedApiProviderOf(
  modelProvider: string,
): OpenCodeLinkedProvider | null {
  if (modelProvider === "zai-coding-plan") return "zai";
  for (const [provider, native] of Object.entries(OPENCODE_LINKED_PROVIDERS))
    if (
      native === modelProvider &&
      isAgentProvider(provider) &&
      isOpenCodeLinkedProvider(provider)
    )
      return provider;
  return null;
}

/** The native destination of one linked key, respecting z.ai's saved account type. */
export function openCodeLinkedModelProvider(connection: {
  readonly provider: OpenCodeLinkedProvider;
  readonly zaiAccountType?: ZaiAccountType;
}): string {
  return connection.provider === "zai" &&
    connection.zaiAccountType === "coding-plan"
    ? "zai-coding-plan"
    : OPENCODE_LINKED_PROVIDERS[connection.provider];
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
 *
 * @remarks
 * `location` says where Pages runs the connection. Pages starts every current
 * provider on this host, a CLI as a local process and an API as a request of
 * the server, so all are local; connections on another machine are remote.
 * `vendor` names the provider whose models a connection offers, so a CLI
 * subscription is listed together with the API of its vendor.
 */
export const AGENT_PROVIDERS = {
  openrouter: {
    accessKind: "api_key",
    labelKey: "settings.agents.provider.openrouter",
    location: "local",
    vendor: "openrouter",
    endpoint: "https://openrouter.ai/api/v1",
  },
  openai: {
    accessKind: "api_key",
    labelKey: "settings.agents.provider.openai",
    location: "local",
    vendor: "openai",
    endpoint: "https://api.openai.com/v1",
  },
  google_ai_studio: {
    accessKind: "api_key",
    labelKey: "settings.agents.provider.google_ai_studio",
    location: "local",
    vendor: "google_ai_studio",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
  },
  zai: {
    accessKind: "api_key",
    labelKey: "settings.agents.provider.zai",
    location: "local",
    vendor: "zai",
    endpoint: "https://api.z.ai/api/paas/v4",
  },
  anthropic: {
    accessKind: "api_key",
    labelKey: "settings.agents.provider.anthropic",
    location: "local",
    vendor: "anthropic",
    endpoint: "https://api.anthropic.com/v1",
  },
  codex_cli: {
    accessKind: "cli_account",
    labelKey: "settings.agents.provider.codex_cli",
    location: "local",
    vendor: "openai",
  },
  claude_code: {
    accessKind: "cli_account",
    labelKey: "settings.agents.provider.claude_code",
    location: "local",
    vendor: "anthropic",
  },
  opencode: {
    accessKind: "cli_account",
    labelKey: "settings.agents.provider.opencode",
    location: "local",
    vendor: "opencode",
  },
} as const;

export const MODEL_TEST_PROMPT = "Reply with exactly: OK";

/** Credentials may only be sent to the fixed endpoint for the saved account type. */
export function apiProviderEndpoint(
  provider: ApiProviderId,
  zaiAccountType?: ZaiAccountType,
): string {
  return provider === "zai" && zaiAccountType === "coding-plan"
    ? "https://api.z.ai/api/coding/paas/v4"
    : AGENT_PROVIDERS[provider].endpoint;
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
  readonly authMethod?: "chatgpt" | "claude.ai" | "openrouter";
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

/** Ephemeral session view. Only the protected login resource returns userCode. */
export interface CliLoginView {
  readonly state: CliLoginState;
  readonly verificationUrl?: string;
  readonly userCode?: string;
  readonly expiresAt?: string;
  readonly errorCode?: AgentErrorCode;
}

/** Whether polling and the login operation lock should remain active. */
export function isLoginActive(state: CliLoginState): boolean {
  return (
    state === "starting" || state === "awaiting_user" || state === "verifying"
  );
}

export interface AgentCliState {
  readonly binaryFound: boolean;
  readonly loggedInAt: string | null;
  readonly accountLabel: string | null;
  readonly login: CliLoginView | null;
  /** Isolated command for the service user; contains no credentials. */
  readonly terminalCommand: string;
}

/** Safe metadata; neither ciphertext nor key fragments belong in this contract. */
export interface AgentConnectionSummary {
  readonly isActive: boolean;
  readonly id: string;
  readonly name: string;
  readonly provider: AgentProviderId;
  /** Absent on earlier projections means the unchanged standard API. */
  readonly zaiAccountType?: ZaiAccountType;
  readonly accessKind: AgentAccessKind;
  readonly hasApiKey: boolean;
  readonly testModel: string | null;
  /** Saved effort for the selected model; null keeps the provider or CLI default. */
  readonly reasoningEffort: string | null;
  /** Who may use the models of this connection; administrators only receive it. */
  readonly scope: AgentConnectionScope;
  readonly cli: AgentCliState | null;
  /** For an OpenCode connection: which Pages API keys it receives automatically. */
  readonly openCodeLinks?: readonly OpenCodeProviderLink[];
  readonly checks: {
    readonly auth: AgentCheckSummary | null;
    readonly model: AgentCheckSummary | null;
  };
  readonly updatedAt: string;
}

export interface AgentConnectionInput {
  readonly name: string;
  readonly provider?: string;
  readonly zaiAccountType?: string;
  readonly apiKey?: string;
  readonly testModel?: string;
  readonly reasoningEffort?: string;
  /**
   * Untrusted usage scope from the request, validated by the service.
   *
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
