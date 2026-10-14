import { vi } from "vitest";

import { planCodexAcpLaunch } from "@/backend/agents/acp/CodexAcpAdapter";
import { codexAcpProfile } from "@/backend/agents/acp/CodexAcpProfile";
import { CodexAcpSession } from "@/backend/agents/acp/CodexAcpSession";

import { FakeAdapterProcess, fakeCodexAgent } from "./fake-codex-adapter";

import type { Mock } from "vitest";
import type { PlanSessionObserver } from "@/backend/agents/AgentPlanExecution";
import type { CodexPermissionMode } from "@/definition/AgentConfiguration";
import type { FakeAdapterOptions, ReceivedCall } from "./fake-codex-adapter";

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
export interface SyntheticNode {
  readonly mode?: CodexPermissionMode;
  readonly model?: string;
  readonly reasoningEffort?: string | null;
  readonly controller?: AbortController;
}

/** A running synthetic session and everything a test inspects. */
export interface StartedSession {
  readonly session: CodexAcpSession;
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
 * @param node - Mode, model, effort and stop signal of the node.
 * @returns The session, the fake process and the recorded calls.
 */
export function startCodexSession(
  adapter: FakeAdapterOptions = {},
  node: SyntheticNode = {},
): StartedSession {
  const controller = node.controller ?? new AbortController();
  const process = new FakeAdapterProcess(controller.signal);
  const fake = fakeCodexAgent(adapter);
  process.connect(fake.app);
  const profile = codexAcpProfile(node.mode ?? "read_only");
  const launch = planCodexAcpLaunch({
    instanceId: INSTANCE_ID,
    codexFile: "/synthetic/bin/codex",
    profile,
    mcp: {
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
  const session = new CodexAcpSession(process, process.channel.stream, {
    instanceId: INSTANCE_ID,
    profile,
    request: {
      directory: WORKSPACE,
      prompt: PROMPT,
      model: node.model ?? "gpt-synthetic",
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

/** The methods the fake adapter received, in order. */
export function methodsOf(calls: readonly ReceivedCall[]): readonly string[] {
  return calls.map((call) => call.method);
}
