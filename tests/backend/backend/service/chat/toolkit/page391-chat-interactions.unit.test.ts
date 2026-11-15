import { afterEach, describe, expect, it, vi } from "vitest";

import { createPicaTools } from "@/backend/service/chat/PicaTools";
import { PicaPlanConfirmation } from "@/backend/service/chat/PicaPlanConfirmation";
import {
  closeAgentToolkitJob,
  createAgentToolkitJob,
} from "@/backend/service/chat/toolkit/AgentToolkit";
import { createAgentShellLauncher } from "@/backend/service/chat/toolkit/AgentShellLauncher";
import { agentToolPolicy } from "@/definition/AgentToolGroups";

import { AGENT_ID, callContext, resultOf, workingFolder } from "./page390-toolkit-world";

import type { AgentToolkitJob } from "@/backend/service/chat/toolkit/AgentToolkitContracts";
import type {
  AgentChatInteractions,
  AgentQuestionOutcome,
  AgentQuestionRequest,
} from "@/definition/AgentChatQuestion";
import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";

// Never start the independent MCP plan catalog in the Pages unit scope.
vi.mock("@/backend/service/chat/PicaPlanTools", () => ({
  registerPicaPlanTools: vi.fn(),
}));

const FIRST = { id: "message-1", text: "Räum bitte auf." };

const jobs: AgentToolkitJob[] = [];

afterEach(async () => {
  for (const job of jobs.splice(0)) await closeAgentToolkitJob(job);
});

/** The chat of a job, faked at its boundary: what the agent says and asks. */
function fakeChat(answer: (request: AgentQuestionRequest) => AgentQuestionOutcome): {
  readonly interactions: AgentChatInteractions;
  readonly said: string[];
  readonly asked: AgentQuestionRequest[];
} {
  const said: string[] = [];
  const asked: AgentQuestionRequest[] = [];
  return {
    said,
    asked,
    interactions: {
      say: async (text) => {
        said.push(text);
        return { messageId: `message-${String(said.length)}` };
      },
      ask: async (request) => {
        asked.push(request);
        return answer(request);
      },
    },
  };
}

async function turnOf(
  interactions: AgentChatInteractions | undefined,
  access: AgentEmployeeAccess = "workspace",
): Promise<{
  readonly tools: ReturnType<typeof createPicaTools>;
  readonly run: ReturnType<typeof vi.fn>;
}> {
  const run = vi.fn(async () => ({ ok: true, result: { deleted: true } }));
  const job = createAgentToolkitJob({
    agentId: AGENT_ID,
    root: await workingFolder(),
    policy: agentToolPolicy(access, []),
    isIsolated: false,
    launcher: createAgentShellLauncher(false),
    ...(interactions ? { interactions } : {}),
  });
  jobs.push(job);
  const approvals = new PicaPlanConfirmation();
  const tools = createPicaTools({
    tools: { run },
    sessions: { confirmationWord: async () => null },
    authorize: async () => undefined,
    message: FIRST.text,
    planTurnId: FIRST.id,
    toolkit: { job, approvals },
  });
  return { tools, run };
}

const answered = (
  chosen: string,
  isRecommendedChosen: boolean,
): AgentQuestionOutcome => ({
  status: "answered",
  questionId: "question-1",
  answeredBy: "Igor",
  answers: [{ question: "?", chosen: [chosen], freeText: null, isRecommendedChosen }],
});

describe("PAGE-391 interim messages", () => {
  it("writes an interim message during the round and lets the round go on", async () => {
    const chat = fakeChat(() => answered("Ja", true));
    const { tools } = await turnOf(chat.interactions);
    const sent = await tools.invoke(
      "nachricht_senden",
      { text: "Bin dran, Tests laufen …" },
      callContext(),
    );
    expect(sent?.output).toMatchObject({ ok: true });
    expect(resultOf(sent?.output)).toMatchObject({ messageId: "message-1" });
    expect(chat.said).toEqual(["Bin dran, Tests laufen …"]);
    // A second one in the same round works as well: the round was not ended.
    await tools.invoke("nachricht_senden", { text: "Fast fertig." }, callContext());
    expect(chat.said).toHaveLength(2);
  });

  it("offers neither tool to a job without a chat, and both to a read-only agent", async () => {
    const without = await turnOf(undefined);
    const ids = without.tools.describe().map((tool) => tool.id);
    expect(ids).not.toContain("nachricht_senden");
    expect(ids).not.toContain("rueckfrage");
    const readOnly = await turnOf(fakeChat(() => answered("Ja", true)).interactions, "read_only");
    const readIds = readOnly.tools.describe().map((tool) => tool.id);
    expect(readIds).toEqual(expect.arrayContaining(["nachricht_senden", "rueckfrage"]));
  });
});

describe("PAGE-391 questions", () => {
  it("asks with buttons, the recommended answer marked, and continues with the answer", async () => {
    const chat = fakeChat(() => answered("PostgreSQL", true));
    const { tools } = await turnOf(chat.interactions);
    const outcome = await tools.invoke(
      "rueckfrage",
      {
        questions: [
          { question: "Welche Datenbank?", options: ["SQLite", "PostgreSQL"], recommended: 1 },
        ],
      },
      callContext(),
    );
    expect(chat.asked[0]).toMatchObject({
      timeoutMinutes: 15,
      confirmation: null,
      items: [{ text: "Welche Datenbank?", recommended: 1, isMultipleChoice: false }],
    });
    expect(resultOf(outcome?.output)).toMatchObject({
      status: "answered",
      answers: [{ chosen: ["PostgreSQL"] }],
      instruction: expect.stringContaining("Continue your work"),
    });
  });

  it("refuses more than three questions or fewer than two options", async () => {
    const { tools } = await turnOf(fakeChat(() => answered("A", true)).interactions);
    const tooMany = await tools.invoke(
      "rueckfrage",
      {
        questions: Array.from({ length: 4 }, () => ({ question: "?", options: ["A", "B"] })),
      },
      callContext(),
    );
    expect(tooMany?.isValid).toBe(false);
    const tooFew = await tools.invoke(
      "rueckfrage",
      { questions: [{ question: "?", options: ["A"] }] },
      callContext(),
    );
    expect(tooFew?.isValid).toBe(false);
  });

  it("tells the agent to continue at its own discretion and say so when nobody answers in time", async () => {
    const chat = fakeChat(() => ({ status: "expired", questionId: "question-1" }));
    const { tools } = await turnOf(chat.interactions);
    const outcome = await tools.invoke(
      "rueckfrage",
      { questions: [{ question: "Weiter?", options: ["Ja", "Nein"] }], timeoutMinutes: 5 },
      callContext(),
    );
    expect(chat.asked[0]?.timeoutMinutes).toBe(5);
    expect(resultOf(outcome?.output)).toMatchObject({
      status: "expired",
      instruction: expect.stringContaining("own discretion"),
    });
  });
});

describe("PAGE-391 confirmation of consequential steps", () => {
  it("runs a held-back deletion in the same round once the person chose the confirming button", async () => {
    const chat = fakeChat(() => answered("Löschen", true));
    const { tools, run } = await turnOf(chat.interactions);
    const held = await tools.invoke("tickets_delete", { ticketId: "ticket-1" }, callContext());
    expect(held?.output).toMatchObject({ error: "CONFIRMATION_REQUIRED" });
    const details = resultOf(held?.output);
    const confirmed = await tools.invoke(
      "rueckfrage",
      {
        questions: [
          { question: "Ticket PAGE-12 wirklich löschen?", options: ["Löschen", "Abbrechen"] },
        ],
        confirms: { tool: details.tool, parameters: details.parameters },
      },
      callContext(),
    );
    expect(chat.asked[0]?.confirmation).toEqual({
      tool: "ticket.delete",
      parameters: { ticketId: "ticket-1" },
    });
    expect(resultOf(confirmed?.output)).toMatchObject({ confirmed: true });
    const deleted = await tools.invoke("tickets_delete", { ticketId: "ticket-1" }, callContext());
    expect(deleted?.output).toMatchObject({ ok: true });
    expect(run).toHaveBeenCalledWith(
      AGENT_ID,
      expect.objectContaining({ operation: "ticket.delete" }),
      null,
    );
  });

  it("keeps the step held back when the person cancels", async () => {
    const chat = fakeChat(() => answered("Abbrechen", false));
    const { tools, run } = await turnOf(chat.interactions);
    await tools.invoke("tickets_delete", { ticketId: "ticket-1" }, callContext());
    const declined = await tools.invoke(
      "rueckfrage",
      {
        questions: [{ question: "Löschen?", options: ["Löschen", "Abbrechen"] }],
        confirms: { tool: "ticket.delete", parameters: { ticketId: "ticket-1" } },
      },
      callContext(),
    );
    expect(resultOf(declined?.output)).toMatchObject({
      confirmed: false,
      instruction: expect.stringContaining("do not perform"),
    });
    const again = await tools.invoke("tickets_delete", { ticketId: "ticket-1" }, callContext());
    expect(again?.output).toMatchObject({ error: "CONFIRMATION_REQUIRED" });
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses to confirm a step Pages did not hold back, so no other step can be approved", async () => {
    const chat = fakeChat(() => answered("Löschen", true));
    const { tools } = await turnOf(chat.interactions);
    await tools.invoke("tickets_delete", { ticketId: "ticket-1" }, callContext());
    const other = await tools.invoke(
      "rueckfrage",
      {
        questions: [{ question: "Löschen?", options: ["Löschen", "Abbrechen"] }],
        confirms: { tool: "ticket.delete", parameters: { ticketId: "ticket-2" } },
      },
      callContext(),
    );
    expect(other?.output).toMatchObject({ ok: false, error: "NOT_HELD" });
    expect(chat.asked).toHaveLength(0);
  });
});
