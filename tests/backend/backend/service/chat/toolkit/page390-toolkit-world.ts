import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { vi } from "vitest";

import { createPicaTools } from "@/backend/service/chat/PicaTools";
import { PicaPlanConfirmation } from "@/backend/service/chat/PicaPlanConfirmation";
import { createAgentToolkitJob } from "@/backend/service/chat/toolkit/AgentToolkit";
import { createAgentShellLauncher } from "@/backend/service/chat/toolkit/AgentShellLauncher";
import { agentToolPolicy } from "@/definition/AgentToolGroups";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import type { AgentBrowserService } from "@/backend/service/chat/browser/AgentBrowserService";
import type { PicaToolOutcome } from "@/backend/service/chat/PicaToolSchemas";
import type { AgentToolkitJob } from "@/backend/service/chat/toolkit/AgentToolkitContracts";
import type { AgentWebPageReader } from "@/backend/service/chat/toolkit/AgentWebTools";
import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { AgentToolGroup } from "@/definition/AgentToolGroups";

export const AGENT_ID = "agent-1";

/** A fresh, private working folder of one chat session. */
export async function workingFolder(): Promise<string> {
  return await realpath(await mkdtemp(path.join(tmpdir(), "page390-")));
}

/** The context of a call; Pages derives it from the job, never from the model. */
export function callContext(runId = "run-1"): RuntimeExecutionContext {
  return {
    userId: AGENT_ID,
    sessionId: "chat-1",
    runId,
    signal: new AbortController().signal,
    authorize: async () => undefined,
  };
}

/** Reads the parsed result of a tool outcome. */
export function resultOf(outcome: unknown): Record<string, unknown> {
  const { result } = outcome as PicaToolOutcome;
  return JSON.parse(result ?? "null") as Record<string, unknown>;
}

/** What one world of a job shares: the Pages, browser and web fakes. */
export interface ToolkitWorld {
  readonly run: ReturnType<typeof vi.fn>;
  readonly browser: ReturnType<typeof vi.fn>;
  readonly readPage: ReturnType<typeof vi.fn>;
  readonly approvals: PicaPlanConfirmation;
  readonly job: AgentToolkitJob;
  /** The registry of one turn of the job, bound to the person's message. */
  readonly turn: (message: { id: string; text: string }) => RuntimeToolRegistry;
}

/**
 * The tools of one chat job of an agent employee, built exactly as a turn
 * builds them, with fakes only at the boundaries: the Pages services, the
 * browser and the network.
 */
export function toolkitWorld(options: {
  readonly root: string;
  readonly access: AgentEmployeeAccess;
  readonly disabled?: readonly AgentToolGroup[];
  readonly readPage?: AgentWebPageReader;
}): ToolkitWorld {
  const run = vi.fn(async (_userId: string, action: { operation: string }) => ({
    ok: true,
    result: { operation: action.operation, id: "ticket-1", key: "PAGE-1" },
  }));
  const browser = vi.fn(async (tool: string) => ({
    ok: true,
    result: JSON.stringify({ tool, title: "Example" }),
    error: null,
  }));
  const readPage = vi.fn(
    options.readPage ??
      (async () => ({
        body: Buffer.from(
          "<html><head><title>Example Domain</title></head><body><h1>Example</h1><p>Hello &amp; welcome.</p></body></html>",
        ),
        contentType: "text/html; charset=utf-8",
        status: 200,
      })),
  );
  const approvals = new PicaPlanConfirmation();
  const policy = agentToolPolicy(options.access, options.disabled ?? []);
  const job = createAgentToolkitJob({
    agentId: AGENT_ID,
    root: options.root,
    policy,
    isIsolated: false,
    launcher: createAgentShellLauncher(false),
    readPage,
  });
  const agentBrowsers = { run: browser } as unknown as AgentBrowserService;
  const turn = (message: { id: string; text: string }): RuntimeToolRegistry =>
    createPicaTools({
      tools: { run },
      sessions: { confirmationWord: async () => null },
      authorize: async () => undefined,
      message: message.text,
      planTurnId: message.id,
      ...(policy.browser === "off" ? {} : { agentBrowsers }),
      toolkit: { job, approvals },
    });
  return { run, browser, readPage, approvals, job, turn };
}
