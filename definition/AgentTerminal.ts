import { z } from "zod";

/**
 * The terminal of a plan node (PAGE-265): the CLI of the node runs in a
 * pseudo terminal, and the browser shows that terminal.
 *
 * @remarks
 * The output is stored redacted in small numbered segments. A viewer gets the
 * current screen and a bounded share of the last segments, then the live
 * segments; older ones are read page by page. Input is checked on the server
 * for every message and reaches only the CLI of the node, never a shell.
 */

/** A stored segment holds at most this much output. */
export const TERMINAL_SEGMENT_CHARACTERS = 16 * 1024;

/** The share of the last segments a viewer gets when it opens the terminal. */
export const TERMINAL_OPEN_CHARACTERS = 96 * 1024;

/** One page of older segments while a viewer scrolls up. */
export const TERMINAL_PAGE_CHARACTERS = 96 * 1024;

/** The output one terminal session keeps; older segments are removed. */
export const TERMINAL_SESSION_CHARACTERS = 8 * 1024 * 1024;

/** Longest keyboard input of one channel message. */
export const TERMINAL_INPUT_FRAGMENT = 8192;

/** Longest text of the multi-line input, sent as one bracketed paste. */
export const TERMINAL_PASTE_CHARACTERS = 20_000;

/** Bounded geometry of the pseudo terminal. */
export const terminalSizeSchema = z.object({
  columns: z.number().int().min(20).max(400),
  rows: z.number().int().min(8).max(200),
});

/** Columns and rows of the pseudo terminal. */
export type AgentTerminalSize = z.infer<typeof terminalSizeSchema>;

/** The CLIs that run in a terminal; Antigravity stays on ACP. */
export const TERMINAL_PROVIDERS = [
  "claude_code",
  "codex_cli",
  "opencode",
] as const;

/** A provider whose plan sessions run in a terminal. */
export type AgentTerminalProvider = (typeof TERMINAL_PROVIDERS)[number];

/**
 * Whether plan sessions of a provider run in a terminal.
 *
 * @param provider - The provider of the connection.
 * @returns `true` for Claude Code, Codex and OpenCode.
 */
export function isTerminalProvider(
  provider: string,
): provider is AgentTerminalProvider {
  return TERMINAL_PROVIDERS.some((entry) => entry === provider);
}

/** What a viewer shows about the terminal beside its output. */
export const terminalStateSchema = z.object({
  status: z.enum(["running", "ended"]),
  columns: z.number().int(),
  rows: z.number().int(),
  /** The CLI draws a full-screen interface; only its own scrolling applies. */
  isAlternateScreen: z.boolean(),
  /** Whether this viewer may type; the server checks it again for every input. */
  canInput: z.boolean(),
  /** The node whose turn runs now; a group shares one terminal. */
  activeStepId: z.string().nullable(),
  /** The open question that failed the node, as the CLI asked it. */
  question: z.string().nullable(),
  /** When the CLI wrote last. */
  lastActivityAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});

/** The state of one terminal for one viewer. */
export type AgentTerminalState = z.infer<typeof terminalStateSchema>;

/** One stored part of the output, already redacted. */
export interface AgentTerminalSegment {
  readonly sequence: number;
  readonly chunk: string;
}

/** What a viewer gets when it opens the terminal. */
export interface AgentTerminalOpening {
  readonly state: AgentTerminalState;
  /**
   * The serialized screen of a full-screen CLI, up to `screenSequence`;
   * `null` for a CLI with ordinary output, which replays its segments.
   */
  readonly screen: string | null;
  readonly screenSequence: number;
  /** The last segments after the screen, or the open share of an ordinary CLI. */
  readonly segments: readonly AgentTerminalSegment[];
  /** Whether older segments than the first one sent are still stored. */
  readonly hasOlder: boolean;
}

/** One page of older segments, oldest first. */
export interface AgentTerminalPage {
  readonly segments: readonly AgentTerminalSegment[];
  readonly hasOlder: boolean;
}

/** Server-to-browser messages of the terminal channel. */
export type AgentTerminalEvent =
  | {
      readonly kind: "output";
      readonly sequence: number;
      readonly chunk: string;
    }
  | { readonly kind: "state"; readonly state: AgentTerminalState }
  /** Segments up to `sequence` are no longer stored; the viewer reloads. */
  | { readonly kind: "gap"; readonly sequence: number };

/** Browser-to-server messages of the terminal channel. */
export const terminalCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("input"),
    data: z.string().min(1).max(TERMINAL_INPUT_FRAGMENT),
  }),
  z.object({
    type: z.literal("paste"),
    text: z.string().min(1).max(TERMINAL_PASTE_CHARACTERS),
  }),
  z.object({ type: z.literal("interrupt") }),
  terminalSizeSchema.extend({ type: z.literal("resize") }),
]);

/** One message of a viewer. */
export type AgentTerminalCommand = z.infer<typeof terminalCommandSchema>;

/** What the server stores for the process of a terminal to apply. */
export type AgentTerminalInput =
  | { readonly kind: "data"; readonly text: string }
  | { readonly kind: "paste"; readonly text: string }
  | { readonly kind: "interrupt" }
  | {
      readonly kind: "resize";
      readonly columns: number;
      readonly rows: number;
    };
