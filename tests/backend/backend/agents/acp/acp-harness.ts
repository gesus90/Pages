import { vi } from "vitest";

import { AcpSession } from "@/backend/agents/acp/AcpSession";
import { CLAUDE_ACP_DRIVER } from "@/backend/agents/acp/ClaudeAcpDriver";
import { CODEX_ACP_DRIVER } from "@/backend/agents/acp/CodexAcpDriver";

import { FakeAdapterProcess, fakeCodexAgent } from "./fake-acp-adapter";

import type { TextExecutionInput } from "@/backend/agents/TextExecution";
import type { Mock } from "vitest";
import type { PlanSessionObserver } from "@/backend/agents/AgentPlanExecution";
import type { AcpPermissionMode } from "@/definition/AgentConfiguration";
import type { FakeAdapterOptions, ReceivedCall } from "./fake-acp-adapter";

/** The instance tag of every synthetic session. */
export const INSTANCE_ID = "instance-synthetic";

/** The workspace of every synthetic session. */
export const WORKSPACE = "/synthetic/workspace";

/** A long prompt with every kind of character that must reach the session unchanged. */
export const PROMPT = [
  "# Synthetic agent",
  'Review {{nothing}} literally, with ümlauts, `code`, "quotes" and a tab\t.',
  "x".repeat(150_000),
  "---",
  "## Pages run contract",
  "End with a pages-report block.",
].join("\n");

/** What a node configures; everything else is the synthetic default. */
export interface SyntheticNode extends Pick<
  TextExecutionInput,
  "ticketInputs" | "readTicketAssets"
> {
  /** The runner of the node; Codex CLI unless named. */
  readonly provider?: "codex_cli" | "claude_code";
  /** Whether the node has the Pages MCP server; it has by default. */
  readonly hasMcp?: boolean;
  readonly mode?: AcpPermissionMode;
  readonly model?: string;
  readonly reasoningEffort?: string | null;
  readonly controller?: AbortController;
}

/** A running synthetic session and everything a test inspects. */
export interface StartedSession {
  readonly session: AcpSession;
  readonly process: FakeAdapterProcess;
  readonly calls: ReceivedCall[];
  readonly observer: {
    readonly started: Mock<PlanSessionObserver["started"]>;
    readonly identified: Mock<PlanSessionObserver["identified"]>;
    readonly progressed: Mock<(events: readonly string[]) => void>;
  };
  readonly secure: Mock<() => Promise<void>>;
}

/**
 * Starts the ACP session of a node against a fake adapter.
 *
 * @param adapter - How the fake adapter behaves.
 * @param node - Runner, mode, model, effort and stop signal of the node.
 * @returns The session, the fake process and the recorded calls.
 */
export function startAcpSession(
  adapter: FakeAdapterOptions = {},
  node: SyntheticNode = {},
): StartedSession {
  const isClaude = node.provider === "claude_code";
  const driver = isClaude ? CLAUDE_ACP_DRIVER : CODEX_ACP_DRIVER;
  const controller = node.controller ?? new AbortController();
  const process = new FakeAdapterProcess(controller.signal);
  const fake = fakeCodexAgent({
    flavor: isClaude ? "claude" : "codex",
    ...adapter,
  });
  process.connect(fake.app);
  const profile = driver.profile(node.mode ?? "read_only");
  const launch = driver.plan({
    instanceId: INSTANCE_ID,
    runnerFile: isClaude ? "/synthetic/bin/claude" : "/synthetic/bin/codex",
    profile,
    mcp:
      node.hasMcp === false
        ? null
        : {
            node: "/synthetic/bin/node",
            bundle: "/synthetic/pages-mcp.cjs",
            url: "http://pages.invalid",
            token: "synthetic-run-token",
            tools: null,
          },
  });
  const observer = {
    started: vi.fn<PlanSessionObserver["started"]>(),
    identified: vi.fn<PlanSessionObserver["identified"]>(),
    progressed: vi.fn<(events: readonly string[]) => void>(),
  };
  const secure = vi.fn(async () => {});
  const session = new AcpSession(process, process.channel.stream, {
    instanceId: INSTANCE_ID,
    driver,
    profile,
    request: {
      directory: WORKSPACE,
      prompt: PROMPT,
      ticketInputs: node.ticketInputs,
      readTicketAssets: node.readTicketAssets,
      model: node.model ?? (isClaude ? "claude-sonnet-5-5" : "gpt-synthetic"),
      reasoningEffort:
        node.reasoningEffort === undefined ? "high" : node.reasoningEffort,
      mcpServers: launch.mcpServers,
      sessionMeta: launch.sessionMeta,
    },
    observer,
    signal: controller.signal,
    isolation: "bubblewrap",
    secure,
  });
  return { session, process, calls: fake.calls, observer, secure };
}

/** Starts the ACP session of a Codex node; see {@link startAcpSession}. */
export function startCodexSession(
  adapter: FakeAdapterOptions = {},
  node: SyntheticNode = {},
): StartedSession {
  return startAcpSession(adapter, { ...node, provider: "codex_cli" });
}

/** The methods the fake adapter received, in order. */
export function methodsOf(calls: readonly ReceivedCall[]): readonly string[] {
  return calls.map((call) => call.method);
}
