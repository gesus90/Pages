import { describe, expect, it } from "vitest";

import { SimulatedAgentMemoryModel } from "@/backend/agents/simulation/SimulatedAgentMemoryModel";

import type { AgentDreamInput } from "@/backend/service/employee/AgentLearningPrompt";

function stub(value: object): never {
  return value as never;
}

const model = new SimulatedAgentMemoryModel();
const caller = stub({ agent: { displayName: "Ada" } });

function exchange(message: string, answer: string): never {
  return stub({
    exchange: { personName: "p", message, answer },
    topics: [],
  });
}

describe("SimulatedAgentMemoryModel.topics", () => {
  it("titles a topic by the first words and names tickets", async () => {
    const [topic] =
      (await model.topics(
        caller,
        exchange(
          "Bitte PAGES-12 prüfen und erledigt melden ja nein",
          "ok PAGES-12 und X-3",
        ),
      )) ?? [];
    expect(topic).toMatchObject({
      title: "Bitte PAGES-12 prüfen und erledigt melden",
      tickets: ["PAGES-12", "X-3"],
      isDone: true,
    });
    expect(topic.status).toContain("Ada hat geantwortet");
  });

  it("keeps an open topic open and skips an empty message", async () => {
    const [open] = (await model.topics(caller, exchange("hallo", "x"))) ?? [];
    expect(open).toMatchObject({ isDone: false, tickets: [] });
    expect(await model.topics(caller, exchange("   ", "x"))).toEqual([]);
  });

  it("cuts a long message", async () => {
    const [topic] =
      (await model.topics(caller, exchange("w ".repeat(400), "a"))) ?? [];
    expect(topic.about.endsWith("…")).toBe(true);
  });
});

describe("SimulatedAgentMemoryModel.summarize", () => {
  it("joins the first words of every message", async () => {
    const summary = await model.summarize(
      caller,
      stub({
        previous: "Früher",
        messages: [{ from: "p", text: "Hallo" }],
      }),
    );
    expect(summary).toBe("Früher · p: Hallo");
    expect(
      await model.summarize(caller, stub({ previous: null, messages: [] })),
    ).toBe("Chat mit Ada");
    expect(
      await model.summarize(caller, stub({ previous: "", messages: [] })),
    ).toBeNull();
  });
});

function dreamInput(extra: Partial<AgentDreamInput> = {}): AgentDreamInput {
  return {
    dream: "",
    topics: [],
    sources: [],
    logbook: [],
    toolUse: { tools: [], repeated: [], failures: [], trace: [] },
    recipes: [],
    today: "2026-01-02",
    ...extra,
  };
}

describe("SimulatedAgentMemoryModel.dream", () => {
  it("derives lessons, topics and a recipe", async () => {
    const sources = stub([
      { kind: "chat", origin: "Pia", text: "alt", at: "t1" },
      { kind: "chat", origin: "→ Ada", text: "skip", at: "t2" },
      { kind: "plan", origin: "Plan A", text: "lief", at: "t3" },
      { kind: "group", origin: "G", text: "skip", at: "t4" },
    ]);
    const answer = await model.dream(
      caller,
      dreamInput({
        sources,
        logbook: [
          {
            kind: "Entscheidung",
            text: "Wir nehmen PAGES-1 und PAGES-1",
            chat: "c1",
            at: "",
          },
          { kind: "Entscheidung", text: "Ohne Ticket", chat: "c3", at: "" },
          { kind: "Offen", text: "später", chat: "c2", at: "" },
        ],
        toolUse: {
          tools: [],
          failures: [],
          trace: [],
          repeated: [
            { tool: "wiki", input: "i", output: "o", error: null, calls: 4 },
          ],
        },
      }),
    );
    expect(answer?.lessons.map((lesson) => lesson.text)).toEqual([
      "Planläufe in Plan A prüfen: lief",
      "Pia wünscht: alt",
    ]);
    expect(answer?.lessons[1].evidence).toBe("Chat von Ada t1");
    expect(answer?.lessons[0].evidence).toBe("Planlauf t3");
    expect(answer?.topics).toEqual([
      expect.objectContaining({
        tickets: ["PAGES-1"],
        entries: [1],
        status: "Festgehalten im Lagebuch (c1)",
      }),
      expect.objectContaining({ tickets: [], entries: [2] }),
    ]);
    expect(answer?.recipes[0]).toMatchObject({ name: "wiki-wiederholt" });
  });

  it("derives nothing from an empty day", async () => {
    expect(await model.dream(caller, dreamInput())).toMatchObject({
      topics: [],
      lessons: [],
      recipes: [],
    });
  });
});

describe("SimulatedAgentMemoryModel.logbook", () => {
  it("writes entries for messages naming tickets or decisions", async () => {
    const message = (from: string, text: string): object => ({
      from,
      at: "",
      text,
    });
    const entries = await model.logbook(
      caller,
      stub({
        chat: "c",
        existing: [],
        messages: [
          message("Ada", "PAGES-1 erledigt"),
          message("Pia", "nichts"),
          message("Pia", "Wir haben beschlossen: weiter"),
          message("Pia", "Bitte PAGES-2 prüfen"),
          message("Pia", "bis morgen"),
          message("Pia", "bis übermorgen"),
        ],
      }),
    );
    expect(entries).toEqual([
      { kind: "open", text: "Pia: bis übermorgen" },
      { kind: "open", text: "Pia: bis morgen" },
      { kind: "open", text: "Pia: Bitte PAGES-2 prüfen" },
    ]);
    const decided = await model.logbook(
      caller,
      stub({
        chat: "c",
        existing: [],
        messages: [message("Pia", "entschieden: ja")],
      }),
    );
    expect(decided?.[0].kind).toBe("decision");
  });
});
