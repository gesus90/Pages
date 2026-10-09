import type { AgentErrorCode } from "@/backend/error/AgentErrors";

/** API keys and CLI accounts remain separate connection types. */
export type ApiProviderId =
  "openrouter" | "openai" | "google_ai_studio" | "zai" | "anthropic";
export type CliProviderId = "codex_cli" | "claude_code";
export type AgentProviderId = ApiProviderId | CliProviderId;
export type AgentAccessKind = "api_key" | "cli_account";
export type AgentCheckKind = "auth" | "model";

/** Fixed endpoints prevent administrators from redirecting saved credentials. */
export const AGENT_PROVIDERS = {
  openrouter: {
    accessKind: "api_key",
    labelKey: "settings.agents.provider.openrouter",
    endpoint: "https://openrouter.ai/api/v1",
  },
  openai: {
    accessKind: "api_key",
    labelKey: "settings.agents.provider.openai",
    endpoint: "https://api.openai.com/v1",
  },
  google_ai_studio: {
    accessKind: "api_key",
    labelKey: "settings.agents.provider.google_ai_studio",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
  },
  zai: {
    accessKind: "api_key",
    labelKey: "settings.agents.provider.zai",
    endpoint: "https://api.z.ai/api/paas/v4",
  },
  anthropic: {
    accessKind: "api_key",
    labelKey: "settings.agents.provider.anthropic",
    endpoint: "https://api.anthropic.com/v1",
  },
  codex_cli: {
    accessKind: "cli_account",
    labelKey: "settings.agents.provider.codex_cli",
  },
  claude_code: {
    accessKind: "cli_account",
    labelKey: "settings.agents.provider.claude_code",
  },
} as const;

export const ZAI_FREE_MODEL = "glm-4.7-flash";
export const MODEL_TEST_PROMPT = "Reply with exactly: OK";

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
  readonly authMethod?: "chatgpt" | "claude.ai";
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
  readonly id: string;
  readonly name: string;
  readonly provider: AgentProviderId;
  readonly accessKind: AgentAccessKind;
  readonly hasApiKey: boolean;
  readonly testModel: string | null;
  /** Saved effort for the selected model; null keeps the provider or CLI default. */
  readonly reasoningEffort: string | null;
  readonly cli: AgentCliState | null;
  readonly checks: {
    readonly auth: AgentCheckSummary | null;
    readonly model: AgentCheckSummary | null;
  };
  readonly updatedAt: string;
}

export interface AgentConnectionInput {
  readonly name: string;
  readonly provider?: string;
  readonly apiKey?: string;
  readonly testModel?: string;
  readonly reasoningEffort?: string;
}

export interface CliToolLocation {
  readonly found: boolean;
  readonly path: string | null;
}

export type CliToolLocations = Readonly<Record<CliProviderId, CliToolLocation>>;
