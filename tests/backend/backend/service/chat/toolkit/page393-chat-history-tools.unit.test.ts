import { afterEach, describe, expect, it, vi } from "vitest";

import { createPicaTools } from "@/backend/service/chat/PicaTools";
import { PicaPlanConfirmation } from "@/backend/service/chat/PicaPlanConfirmation";
import {
  closeAgentToolkitJob,
  createAgentToolkitJob,
} from "@/backend/service/chat/toolkit/AgentToolkit";
import { createAgentShellLauncher } from "@/backend/service/chat/toolkit/AgentShellLauncher";
import { classifyBridgeTool } from "@/backend/service/chat/toolkit/AgentToolkitCatalog";
import { agentToolPolicy } from "@/definition/AgentToolGroups";

import {
  historyWorld,
  storedMessage,
} from "../../conversation/page393-chat-history-world";
import {
  AGENT_ID,
  callContext,
  resultOf,
  workingFolder,
} from "./page390-toolkit-world";

import type { AgentToolkitJob } from "@/backend/service/chat/toolkit/AgentToolkitContracts";
import type { AgentChatHistory } from "@/definition/AgentChatHistory";
import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { AgentToolGroup } from "@/definition/AgentToolGroups";

// Never start the independent MCP plan catalog in the Pages unit scope.
vi.mock("@/backend/service/chat/PicaPlanTools", () => ({
  registerPicaPlanTools: vi.fn(),
}));

const jobs: AgentToolkitJob[] = [];

afterEach(async () => {
  for (const job of jobs.splice(0)) await closeAgentToolkitJob(job);
});

async function turnOf(
  history: AgentChatHistory | undefined,
  options: {
    readonly access?: AgentEmployeeAccess;
    readonly disabled?: readonly AgentToolGroup[];
  } = {},
): Promise<ReturnType<typeof createPicaTools>> {
  const job = createAgentToolkitJob({
    agentId: AGENT_ID,
    root: await workingFolder(),
    policy: agentToolPolicy(
      options.access ?? "workspace",
      options.disabled ?? [],
    ),
    isIsolated: false,
    launcher: createAgentShellLauncher(false),
    ...(history ? { history } : {}),
  });
  jobs.push(job);
  return createPicaTools({
    tools: { run: vi.fn(async () => ({ ok: true, result: {} })) },
    sessions: { confirmationWord: async () => null },
    authorize: async () => undefined,
    message: "Was hatten wir letzten Monat zur Ruhezeit entschieden?",
    planTurnId: "message-1",
    toolkit: { job, approvals: new PicaPlanConfirmation() },
  });
}

const DECISION = storedMessage({
  source: "conversation",
  chatKind: "group",
  chatId: "group-team",
  chatName: "Pages-Team",
  conversationId: "group-team",
  messageId: "group-7",
  position: 7,
  senderName: "Mei",
  createdAt: "2026-10-20T09:00:00.000Z",
  text: "Entschieden: Die Ruhezeit bleibt bei 11 Stunden.",
});

describe("PAGE-393 tools verlauf_durchsuchen and verlauf_lesen", () => {
  it("finds the earlier decision with chat, sender and time and reads around it", async () => {
    const world = historyWorld({
      found: [DECISION],
      excerpt: [
        storedMessage({
          ...DECISION,
          messageId: "group-6",
          position: 6,
          senderName: "Igor",
          text: "Wie halten wir es mit der Ruhezeit?",
        }),
        DECISION,
        storedMessage({
          ...DECISION,
          messageId: "group-8",
          position: 8,
          senderName: "Ed",
          text: "Notiert.",
        }),
      ],
    });
    const tools = await turnOf(
      world.service.bind(AGENT_ID, {
        kind: "conversation",
        conversationId: "group-team",
      }),
    );
    const searched = await tools.invoke(
      "verlauf_durchsuchen",
      {
        query: "Ruhezeit entschieden",
        since: "2026-10-01",
        until: "2026-10-31",
      },
      callContext(),
    );
    expect(searched?.output).toMatchObject({ ok: true });
    expect(resultOf(searched?.output)).toEqual({
      hits: [
        {
          messageId: "group-7",
          chat: { kind: "group", id: "group-team", name: "Pages-Team" },
          from: "Mei",
          at: "2026-10-20T09:00:00.000Z",
          snippet: "Entschieden: Die Ruhezeit bleibt bei 11 Stunden.",
          isThisChat: true,
          link: "/chat?kind=group&id=group-team&message=group-7",
        },
      ],
    });

    const read = await tools.invoke(
      "verlauf_lesen",
      { messageId: "group-7", before: 1, after: 1 },
      callContext(),
    );
    const excerpt = resultOf(read?.output);
    expect(excerpt).toMatchObject({
      chat: { kind: "group", id: "group-team", name: "Pages-Team" },
      messages: [
        { messageId: "group-6", from: "Igor", isHit: false },
        { messageId: "group-7", from: "Mei", isHit: true },
        { messageId: "group-8", from: "Ed", isHit: false },
      ],
    });
  });

  it("hints at other words without a hit and answers NOT_FOUND for a hidden message", async () => {
    const tools = await turnOf(
      historyWorld().service.bind(AGENT_ID, {
        kind: "direct",
        personId: "igor",
      }),
    );
    const none = await tools.invoke(
      "verlauf_durchsuchen",
      { query: "Urlaub" },
      callContext(),
    );
    expect(resultOf(none?.output)).toMatchObject({
      hits: [],
      hint: expect.any(String),
    });
    const hidden = await tools.invoke(
      "verlauf_lesen",
      { messageId: "secret-1" },
      callContext(),
    );
    expect(hidden?.output).toMatchObject({ ok: false, error: "NOT_FOUND" });
  });

  it("validates the input", async () => {
    const tools = await turnOf(historyWorld().service.bind(AGENT_ID, null));
    const badDay = await tools.invoke(
      "verlauf_durchsuchen",
      { query: "Ruhezeit", since: "letzten Monat" },
      callContext(),
    );
    expect(badDay?.isValid).toBe(false);
    const tooMuch = await tools.invoke(
      "verlauf_lesen",
      { messageId: "m", before: 50 },
      callContext(),
    );
    expect(tooMuch?.isValid).toBe(false);
  });

  it("belongs to the chat group as a reading tool and follows it", async () => {
    expect(classifyBridgeTool("verlauf_durchsuchen")).toEqual({
      group: "chat",
      isWrite: false,
    });
    expect(classifyBridgeTool("verlauf_lesen")).toEqual({
      group: "chat",
      isWrite: false,
    });
    const history = historyWorld().service.bind(AGENT_ID, null);
    const readOnly = (await turnOf(history, { access: "read_only" }))
      .describe()
      .map((tool) => tool.id);
    expect(readOnly).toEqual(
      expect.arrayContaining(["verlauf_durchsuchen", "verlauf_lesen"]),
    );
    const chatOff = (await turnOf(history, { disabled: ["chat"] }))
      .describe()
      .map((tool) => tool.id);
    expect(chatOff).not.toContain("verlauf_durchsuchen");
    expect(chatOff).not.toContain("verlauf_lesen");
    const without = (await turnOf(undefined)).describe().map((tool) => tool.id);
    expect(without).not.toContain("verlauf_durchsuchen");
  });
});
