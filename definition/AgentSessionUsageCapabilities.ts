import type { AcpProviderId } from "./AgentConfiguration";

/**
 * How an adapter counts the tokens of `PromptResponse.usage`.
 * @remarks
 * `per_prompt` reports one prompt; `session_total` reports the native session
 * so far, as the ACP schema describes `Usage`, so a turn is the difference to
 * the report before it.
 */
export type AcpTokenCounting = "per_prompt" | "session_total";

/** What Pages verified about the token counts of one adapter. */
export interface AcpUsageCapability {
  readonly counting: AcpTokenCounting;
  /** Whether input contains cache reads; `null` while not verified. */
  readonly inputIncludesCache: boolean | null;
  /** The adapter reports only part of a turn. */
  readonly isPartial: boolean;
}

/**
 * The token counting of every ACP adapter Pages runs.
 * @remarks
 * From the capability notes next to the drivers: claude-agent-acp reports
 * input without cache and a total of all four counts; codex-acp reports each
 * prompt, whether its input contains cached input is not verified; OpenCode
 * reports only the last model step of a turn.
 */
export const ACP_USAGE_CAPABILITIES: Readonly<
  Record<AcpProviderId, AcpUsageCapability>
> = {
  claude_code: {
    counting: "per_prompt",
    inputIncludesCache: false,
    isPartial: false,
  },
  codex_cli: {
    counting: "per_prompt",
    inputIncludesCache: null,
    isPartial: false,
  },
  antigravity: {
    counting: "per_prompt",
    inputIncludesCache: null,
    isPartial: true,
  },
  opencode: {
    counting: "per_prompt",
    inputIncludesCache: null,
    isPartial: true,
  },
  openrouter: {
    counting: "per_prompt",
    inputIncludesCache: null,
    isPartial: true,
  },
};
