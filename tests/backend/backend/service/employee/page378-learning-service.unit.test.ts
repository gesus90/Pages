import { expect, it } from "vitest";

import { parseDreamDocument } from "@/backend/service/employee/AgentDreamDocument";

import {
  AGENT,
  EMPTY_ANSWER,
  dreamWorld,
  entry,
} from "./page378-dream-fixture";
import { recipe } from "./page378-recipe-fixture";

import type { AgentDreamAnswer } from "@/backend/service/employee/AgentLearningPrompt";

const RELEASE_TOPIC = {
  title: "Release am Freitag",
  about: "Der Release ist am Freitag.",
  status: "Beschlossen mit Igor",
  nextStep: "Testserver prüfen",
  tickets: ["PAGE-370"],
  wikiPages: [],
  isDone: false,
  entries: [1],
};

const ANSWER: AgentDreamAnswer = {
  topics: [
    RELEASE_TOPIC,
    {
      // No entry it rests on: no source, so it is left out.
      title: "Ohne Quelle",
      about: "x",
      status: "x",
      nextStep: "",
      tickets: [],
      wikiPages: [],
      isDone: false,
      entries: [],
    },
  ],
  discarded: [2],
  lessons: [
    {
      text: "Das Pages-Repo liegt unter /home/igor/Repo/Pages, nicht suchen.",
      evidence: "5× find im Home-Verzeichnis",
      date: "2026-11-13",
    },
  ],
  recipes: [],
  dropRecipes: [],
};

it("takes the durable points of the Lagebuch into MEMORY.md and the lessons with evidence into DREAM.md", async () => {
  const world = dreamWorld(ANSWER);
  world.logbook.entries = [
    entry(1),
    entry(2, {
      kind: "open",
      text: "Kaffee kaufen",
      source: { kind: "group", id: "g-1", name: "Pages-Team" },
    }),
  ];

  const result = await world.service.run(AGENT);

  expect(result).toMatchObject({
    status: "updated",
    added: 1,
    merged: 0,
    removed: 0,
    errorCode: null,
  });
  // MEMORY.md: one topic with its source chat, the ticket and the date.
  const [topic, ...rest] = world.memory().entries;
  expect(rest).toEqual([]);
  expect(topic?.title).toBe("Release am Freitag");
  expect(topic?.text).toContain("- Worum es geht: Der Release ist am Freitag.");
  expect(topic?.text).toContain("[Chat mit Igor](chat:person/igor)");
  expect(topic?.text).toContain("[PAGE-370](/tasks/PAGE-370)");
  expect(topic?.text).toContain("- Datum: 2026-11-13");
  expect(topic?.source.chat).toEqual({ kind: "person", personId: "igor" });
  // DREAM.md: the lesson with evidence, date and strength.
  expect(world.employee.value.dream).toBe(
    "- Das Pages-Repo liegt unter /home/igor/Repo/Pages, nicht suchen. — Beleg: 5× find im Home-Verzeichnis · Datum: 2026-11-13 · Stärke: 1",
  );
  // The log names what was taken over, learned and discarded; the position moves on.
  const [run] = world.saved.runs;
  expect(run).toMatchObject({
    status: "updated",
    trigger: "schedule",
    counts: { memoryTaken: 1, memoryDropped: 1, lessonLearned: 1 },
  });
  expect(run?.log).toEqual([
    { kind: "memoryTaken", text: "Release am Freitag" },
    { kind: "memoryDropped", text: "Kaffee kaufen (erledigt oder veraltet)" },
    {
      kind: "lessonLearned",
      text: "Das Pages-Repo liegt unter /home/igor/Repo/Pages, nicht suchen.",
    },
  ]);
  expect(world.dreaming.value.logbookThrough).toBe(2);
});

it("takes a topic from a group chat with the rules of sharing of that group", async () => {
  const world = dreamWorld({
    ...EMPTY_ANSWER,
    topics: [RELEASE_TOPIC],
  });
  world.logbook.entries = [
    entry(1, { source: { kind: "group", id: "g-1", name: "Pages-Team" } }),
  ];
  await world.service.run(AGENT);
  expect(world.memory().entries[0]?.source.chat).toEqual({
    kind: "conversation",
    conversationId: "g-1",
  });
  expect(world.memory().entries[0]?.text).toContain(
    "[Gruppe „Pages-Team“](chat:conversation/g-1)",
  );
});

it("strengthens a confirmed lesson and lets the weakest fall out of a full DREAM.md", async () => {
  const world = dreamWorld({
    ...EMPTY_ANSWER,
    lessons: [
      {
        text: "Das Pages-Repo liegt unter /home/igor/Repo/Pages, nicht suchen.",
        evidence: "noch einmal",
        date: "2026-11-13",
      },
      {
        text: "Status-ID für Review ist status-review.",
        evidence: "Ticket PAGE-1",
        date: "2026-11-13",
      },
    ],
  });
  world.sources.entries = [
    { kind: "chat", at: "2026-11-13 01:00:00", origin: "Igor", text: "hallo" },
  ];
  world.employee.value = {
    ...world.employee.value,
    dream:
      "- Das Pages-Repo liegt unter /home/igor/Repo/Pages, nicht suchen. — Beleg: früher · Datum: 2026-11-01 · Stärke: 3\n- Eine alte schwache Lektion. — Beleg: x · Datum: 2026-10-01 · Stärke: 1",
    dreamCharacters: 200,
  };

  const result = await world.service.run(AGENT);

  const lessons = parseDreamDocument(world.employee.value.dream, "2026-11-13");
  expect(result).toMatchObject({ merged: 1, removed: 2 });
  expect(lessons).toHaveLength(1);
  expect(lessons[0]).toMatchObject({ strength: 4, date: "2026-11-13" });
  expect(world.saved.runs[0]?.log).toEqual(
    expect.arrayContaining([
      {
        kind: "lessonStrengthened",
        text: "Das Pages-Repo liegt unter /home/igor/Repo/Pages, nicht suchen.",
      },
      { kind: "lessonDropped", text: "Eine alte schwache Lektion." },
    ]),
  );
});

it("starts no run while the agent works in a chat, and a scheduled run stays due until it can start", async () => {
  const world = dreamWorld(ANSWER);
  world.logbook.entries = [entry(1)];
  world.isWorking.value = true;

  expect(await world.service.run(AGENT)).toBeNull();
  expect(world.model.dream).not.toHaveBeenCalled();
  expect(world.saved.learning).toEqual([]);
  expect(world.saved.requests).toEqual([]);
  // Nothing changed, so the schedule still says "due": the next look starts it.
  expect(await world.service.isDue(world.employee.value)).toBe(true);

  world.isWorking.value = false;
  expect(await world.service.run(AGENT)).toMatchObject({ status: "updated" });
  expect(world.model.dream).toHaveBeenCalledTimes(1);
});

it("keeps a run somebody asked for until the agent leaves its chats, and runs it with the trigger it was asked with", async () => {
  const world = dreamWorld(ANSWER);
  world.logbook.entries = [entry(1)];
  world.isWorking.value = true;

  expect(await world.service.request(AGENT, "manual")).toBe("waiting");
  expect(world.saved.requests).toEqual([
    { at: "2026-11-13 02:00:00", trigger: "manual" },
  ]);
  expect(await world.service.run(AGENT, { trigger: "logbook" })).toBeNull();
  expect(world.model.dream).not.toHaveBeenCalled();
  expect(await world.service.isDue(world.employee.value)).toBe(true);

  world.isWorking.value = false;
  expect(await world.service.request(AGENT, "manual")).toBe("started");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(world.model.dream).toHaveBeenCalledTimes(1);
  expect(world.saved.runs[0]).toMatchObject({ trigger: "manual" });
  // The request is gone once the run ended.
  expect(world.employee.value.dreamRequest).toBeNull();
});

it("lets a full Lagebuch ask for a run that waits while the agent works in a chat and then runs as a run of the Lagebuch", async () => {
  const world = dreamWorld(ANSWER);
  world.logbook.entries = [entry(1)];
  world.isWorking.value = true;
  expect(await world.service.run(AGENT, { trigger: "logbook" })).toBeNull();
  expect(world.saved.requests).toEqual([
    { at: "2026-11-13 02:00:00", trigger: "logbook" },
  ]);
  expect(world.model.dream).not.toHaveBeenCalled();

  world.isWorking.value = false;
  await world.service.run(AGENT, {
    trigger: world.employee.value.dreamRequest?.trigger ?? "schedule",
  });
  expect(world.saved.runs[0]).toMatchObject({
    trigger: "logbook",
    status: "updated",
  });
});

it("asks no model when nothing is new, and says so", async () => {
  const world = dreamWorld(ANSWER);
  const result = await world.service.run(AGENT, { trigger: "manual" });
  expect(result).toMatchObject({ status: "unchanged" });
  expect(world.model.dream).not.toHaveBeenCalled();
  expect(world.saved.runs[0]).toMatchObject({
    status: "unchanged",
    trigger: "manual",
    log: [],
  });
  // The run still counts as the last one, so the schedule moves on.
  expect(world.employee.value.lastLearningAt).toBe("2026-11-13 02:00:00");
});

it("fails without moving what it read when the model gives no usable answer", async () => {
  const world = dreamWorld(null);
  world.logbook.entries = [entry(1)];
  world.sources.entries = [
    { kind: "chat", at: "2026-11-13 01:00:00", origin: "Igor", text: "hallo" },
  ];
  const result = await world.service.run(AGENT);
  expect(result).toMatchObject({
    status: "failed",
    errorCode: "invalidAnswer",
  });
  expect(world.dreaming.value.logbookThrough).toBe(0);
  expect(world.employee.value.learnedThrough).toBeNull();
  expect(world.employee.value.memory).toBe("");
});

it("learns from the tool calls: it hands them to the model and moves its position", async () => {
  const world = dreamWorld({
    ...EMPTY_ANSWER,
    lessons: [
      {
        text: "storage_upload kennt kein rename, nimm keep_both.",
        evidence: "3 Fehlschläge",
        date: "2026-11-13",
      },
    ],
  });
  const uses = world.recipes.store().toolUses();
  for (let index = 0; index < 3; index += 1)
    await uses.append(AGENT, {
      tool: "storage_upload",
      input: '{"conflict":"rename"}',
      output: "",
      isOk: false,
      error: "INVALID_INPUT",
    });
  await uses.append(AGENT, {
    tool: "tickets_search",
    input: '{"q":"x"}',
    output: "[]",
    isOk: true,
    error: null,
  });

  await world.service.run(AGENT);

  const input = world.model.dream.mock.calls[0]?.[1] as {
    toolUse: {
      tools: { tool: string; calls: number; failures: number }[];
      repeated: { tool: string; calls: number }[];
      failures: { error: string }[];
    };
  };
  expect(input.toolUse.tools[0]).toEqual({
    tool: "storage_upload",
    calls: 3,
    failures: 3,
  });
  expect(input.toolUse.repeated[0]).toMatchObject({
    tool: "storage_upload",
    calls: 3,
  });
  expect(input.toolUse.failures).toHaveLength(1);
  expect(world.employee.value.dream).toContain(
    "storage_upload kennt kein rename, nimm keep_both.",
  );
  expect(world.dreaming.value.toolsThrough).toBe(4);
});

/** The recipes the model answers in the run that creates, corrects and drops recipes. */
const RECIPE_ANSWERS: AgentDreamAnswer["recipes"] = [
  {
    name: "Ticket anlegen",
    kind: "flow",
    summary: "Legt ein Ticket an und liest es.",
    keywords: ["ticket"],
    parameters: [{ name: "projekt", description: "ID" }],
    steps: [
      {
        tool: "tickets_create",
        input: { projectId: "{{projekt}}" },
        note: "anlegen",
      },
      {
        tool: "tickets_read",
        input: { ticketId: "{{1.id}}" },
        note: "Kontrolle",
      },
    ],
    evidence: "4× in Sitzungen",
  },
  {
    name: "Pages-Repo",
    kind: "knowledge",
    summary: "Wo das Repo liegt",
    keywords: ["repo"],
    body: "Unter /home/igor/Repo/Pages.",
    evidence: "5× gesucht",
  },
  // A tool the agent never used, a deleting tool: both refused.
  {
    name: "Unbekannt",
    kind: "flow",
    summary: "x",
    steps: [{ tool: "tickets_move", input: {}, note: "" }],
  },
  {
    name: "Aufräumen",
    kind: "flow",
    summary: "x",
    steps: [{ tool: "tickets_delete", input: { ticketId: "1" }, note: "" }],
  },
];

it("creates recipes that work at once, corrects a failed one, and drops what it names", async () => {
  const world = dreamWorld({
    ...EMPTY_ANSWER,
    recipes: RECIPE_ANSWERS,
    dropRecipes: ["alt"],
  });
  world.sources.entries = [
    { kind: "chat", at: "2026-11-13 01:00:00", origin: "Igor", text: "hallo" },
  ];
  const uses = world.recipes.store().toolUses();
  for (const tool of ["tickets_create", "tickets_read", "tickets_delete"])
    await uses.append(AGENT, {
      tool,
      input: "{}",
      output: "{}",
      isOk: true,
      error: null,
    });
  world.recipes.recipes = [
    recipe({ id: "old", name: "alt", origin: "dream" }),
    recipe({
      id: "broken",
      name: "ticket-anlegen",
      isActive: false,
      disabledReason: "failed",
      failureStreak: 2,
      lastError: "tickets_create: FORBIDDEN",
      strength: 2,
    }),
  ];

  const result = await world.service.run(AGENT);

  expect(result).toMatchObject({ status: "updated" });
  const names = world.recipes.recipes.map((stored) => stored.name).sort();
  expect(names).toEqual(["pages-repo", "ticket-anlegen"]);
  // The failed recipe was corrected: new steps, stronger, on again with a clean slate.
  const corrected = world.recipes.recipes.find(
    (stored) => stored.name === "ticket-anlegen",
  );
  expect(corrected).toMatchObject({
    isActive: true,
    disabledReason: null,
    failureStreak: 0,
    strength: 3,
    summary: "Legt ein Ticket an und liest es.",
  });
  expect(corrected?.steps.map((step) => step.tool)).toEqual([
    "tickets_create",
    "tickets_read",
  ]);
  const created = world.recipes.recipes.find(
    (stored) => stored.name === "pages-repo",
  );
  expect(created).toMatchObject({
    kind: "knowledge",
    isActive: true,
    origin: "dream",
    strength: 1,
    useCount: 0,
  });
  expect(created?.confirmedOn).toBe("2026-11-13");
  expect(world.saved.runs[0]?.log).toEqual(
    expect.arrayContaining([
      { kind: "recipeDropped", text: "alt (verworfen)" },
      { kind: "recipeUpdated", text: "ticket-anlegen" },
      { kind: "recipeCreated", text: "pages-repo" },
    ]),
  );
});

it("lets a rarely used recipe of the dream fall out but keeps one somebody wrote by hand", async () => {
  const world = dreamWorld(EMPTY_ANSWER);
  world.sources.entries = [
    { kind: "chat", at: "2026-11-13 01:00:00", origin: "Igor", text: "hallo" },
  ];
  world.recipes.recipes = [
    recipe({
      id: "stale",
      name: "selten",
      strength: 1,
      useCount: 0,
      confirmedOn: "2026-08-01",
    }),
    recipe({
      id: "hand",
      name: "von-hand",
      strength: 1,
      useCount: 0,
      confirmedOn: "2026-08-01",
      origin: "manual",
    }),
    recipe({
      id: "fresh",
      name: "frisch",
      strength: 1,
      useCount: 0,
      confirmedOn: "2026-11-10",
    }),
    recipe({
      id: "used",
      name: "oft",
      strength: 1,
      useCount: 9,
      confirmedOn: "2026-08-01",
    }),
  ];
  await world.service.run(AGENT);
  expect(world.recipes.recipes.map((stored) => stored.name).sort()).toEqual([
    "frisch",
    "oft",
    "von-hand",
  ]);
  expect(world.saved.runs[0]?.log).toEqual([
    { kind: "recipeDropped", text: "selten (selten genutzt)" },
  ]);
});

it("does not run twice at once", async () => {
  const world = dreamWorld(ANSWER);
  world.logbook.entries = [entry(1)];
  const first = world.service.run(AGENT);
  expect(world.service.isRunning(AGENT)).toBe(true);
  expect(await world.service.run(AGENT)).toBeNull();
  await first;
  expect(world.service.isRunning(AGENT)).toBe(false);
  expect(world.model.dream).toHaveBeenCalledTimes(1);
});
