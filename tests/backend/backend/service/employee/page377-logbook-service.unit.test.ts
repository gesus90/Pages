import { expect, it } from "vitest";

import {
  AGENT_LOGBOOK_COMPACTION_PERCENT,
  AGENT_LOGBOOK_TEXT_CHARACTERS,
} from "@/definition/AgentLogbook";

import {
  FakeLogbook,
  IGOR,
  RELEASE,
  TEAM,
  logbookWorld,
  settings,
} from "./page377-logbook-fixture";

import type { LogbookWorld } from "./page377-logbook-fixture";

const AGENT = "ed";

function toolsOf(
  world: LogbookWorld,
  session: { readonly sessionId: string },
): ReturnType<LogbookWorld["service"]["tools"]> {
  return world.service.tools({ agentId: AGENT, sessionId: session.sessionId });
}

async function remember(
  world: LogbookWorld,
  session: { readonly sessionId: string },
  art: string,
  text: string,
): Promise<unknown> {
  return toolsOf(world, session).remember({ art, text });
}

it("finds in chat B with lagebuch_suchen what the agent kept in chat A with lagebuch_merken", async () => {
  const world = logbookWorld();
  world.logbook.participants.set("group:group-team", ["Igor", "Mei"]);

  const saved = await remember(
    world,
    TEAM,
    "entscheidung",
    "PAGE-370 übernimmt Ed bis Freitag.",
  );
  expect(saved).toEqual({
    gespeichert: true,
    art: "Entscheidung",
    chat: "Gruppe „Pages-Team“",
  });

  // Another chat of the same agent looks it up.
  const found = await toolsOf(world, IGOR).search({ text: "PAGE-370" });
  expect(found).toEqual({
    eintraege: [
      {
        zeit: "2026-11-13 17:05",
        chat: "Gruppe „Pages-Team“",
        art: "Entscheidung",
        text: "PAGE-370 übernimmt Ed bis Freitag.",
        beteiligte: ["Igor", "Mei"],
        von: "Agent",
      },
    ],
  });
  // Time, source chat and people travel with the entry in the store.
  expect(world.logbook.entries[0]).toMatchObject({
    agentId: AGENT,
    kind: "decision",
    origin: "agent",
    source: { kind: "group", id: "group-team", name: "Pages-Team" },
    participants: ["Igor", "Mei"],
    createdAt: "2026-11-13T17:05:00.000Z",
  });
});

it("reads the Lagebuch by chat, by topic, by both and without either", async () => {
  const world = logbookWorld();
  await remember(world, TEAM, "fakt", "Der Testserver heißt staging-2.");
  await remember(world, RELEASE, "aufgabe", "Release-Notizen schreibt Mei bis Mittwoch.");
  await remember(world, IGOR, "frage", "Soll der Testserver nachts laufen?");
  const tools = toolsOf(world, IGOR);

  const byChat = (await tools.read({ chat: "release" })) as {
    eintraege: { text: string }[];
  };
  expect(byChat.eintraege.map((entry) => entry.text)).toEqual([
    "Release-Notizen schreibt Mei bis Mittwoch.",
  ]);

  const byTopic = (await tools.read({ thema: "testserver" })) as {
    eintraege: { text: string }[];
  };
  // Newest first.
  expect(byTopic.eintraege.map((entry) => entry.text)).toEqual([
    "Soll der Testserver nachts laufen?",
    "Der Testserver heißt staging-2.",
  ]);

  const both = (await tools.read({ chat: "Pages-Team", thema: "testserver" })) as {
    eintraege: { text: string }[];
  };
  expect(both.eintraege).toHaveLength(1);

  const all = (await tools.read({})) as { eintraege: unknown[] };
  expect(all.eintraege).toHaveLength(3);

  expect(await tools.search({ text: "gibt es nicht" })).toEqual({
    eintraege: [],
    hinweis: "Keine passenden Einträge im Lagebuch.",
  });
});

it("takes all five kinds by their German names and refuses any other word", async () => {
  const world = logbookWorld();
  const names: Record<string, string> = {
    entscheidung: "decision",
    aufgabe: "open",
    fakt: "fact",
    frage: "question",
    Notiz: "note",
  };
  for (const [name, kind] of Object.entries(names)) {
    await remember(world, TEAM, name, `Text zu ${name}`);
    expect(world.logbook.entries.at(-1)?.kind).toBe(kind);
  }
  const refused = await remember(world, TEAM, "gerücht", "Text");
  expect(refused).toMatchObject({ gespeichert: false });
  expect(world.logbook.entries).toHaveLength(5);
});

it("leaves out a repeat of an entry the chat wrote before and cuts a long text", async () => {
  const world = logbookWorld();
  await remember(world, TEAM, "fakt", "Der Release ist am Freitag.");
  const again = await remember(world, TEAM, "fakt", "  der   release ist am Freitag. ");
  expect(again).toEqual({
    gespeichert: false,
    grund: "Ein gleicher Eintrag aus diesem Chat steht schon im Lagebuch.",
  });
  expect(world.logbook.entries).toHaveLength(1);
  // The same words in another chat are an entry of that chat.
  await remember(world, RELEASE, "fakt", "Der Release ist am Freitag.");
  expect(world.logbook.entries).toHaveLength(2);

  const recorded = await world.service.record(
    AGENT,
    { kind: "direct", id: IGOR.chatId, name: IGOR.chatName },
    [{ kind: "note", text: "x".repeat(AGENT_LOGBOOK_TEXT_CHARACTERS + 100) }],
    "background",
  );
  expect(recorded.saved).toBe(1);
  expect(
    Array.from(world.logbook.entries.at(-1)?.text ?? "").length,
  ).toBeLessThanOrEqual(AGENT_LOGBOOK_TEXT_CHARACTERS);
});

it("names an entry by a short topic of its text or by the topic the model gave", async () => {
  const world = logbookWorld();
  await remember(
    world,
    TEAM,
    "entscheidung",
    "PAGE-370 übernimmt Ed bis Freitag. Danach prüft Mei den Stand.",
  );
  await world.service.record(
    AGENT,
    { kind: "group", id: TEAM.chatId, name: TEAM.chatName },
    [{ kind: "open", text: "Mei prüft den Stand.", topic: "Stand prüfen" }],
    "background",
  );
  expect(world.logbook.entries.map((entry) => entry.topic)).toEqual([
    "PAGE-370 übernimmt Ed bis Freitag",
    "Stand prüfen",
  ]);
});

it("writes nothing from a confidential chat and finds nothing of it", async () => {
  const world = logbookWorld();
  await remember(world, TEAM, "fakt", "Der Testserver heißt staging-2.");
  world.logbook.confidential.add("direct:person-igor");

  const refused = await remember(world, IGOR, "fakt", "Igors Gehalt wird erhöht.");
  expect(refused).toEqual({
    gespeichert: false,
    grund:
      "Dieser Chat ist vertraulich: Aus ihm schreibt Pages nichts ins gemeinsame Lagebuch.",
  });
  expect(world.logbook.entries).toHaveLength(1);

  // The background summary is refused the same way, whatever the model returned.
  const background = await world.service.record(
    AGENT,
    { kind: "direct", id: IGOR.chatId, name: IGOR.chatName },
    [{ kind: "fact", text: "Igors Gehalt wird erhöht." }],
    "background",
  );
  expect(background).toEqual({ saved: 0, isConfidential: true });
  expect(world.logbook.entries).toHaveLength(1);

  // A confidential group is refused, too.
  world.logbook.confidential.add("group:group-release");
  expect(
    await remember(world, RELEASE, "fakt", "Geheimer Termin."),
  ).toMatchObject({ gespeichert: false });
  expect(world.logbook.entries).toHaveLength(1);
});

it("does not let search, read or the hint reach entries of a chat that became confidential", async () => {
  const world = logbookWorld();
  await remember(world, IGOR, "fakt", "Igors Urlaub beginnt im Mai.");
  await remember(world, TEAM, "fakt", "Der Testserver heißt staging-2.");
  world.logbook.confidential.add("direct:person-igor");

  const tools = toolsOf(world, RELEASE);
  expect(await tools.search({ text: "Urlaub" })).toMatchObject({ eintraege: [] });
  const all = (await tools.read({})) as { eintraege: { text: string }[] };
  expect(all.eintraege.map((entry) => entry.text)).toEqual([
    "Der Testserver heißt staging-2.",
  ]);
  const hint = await world.service.hint({
    agentId: AGENT,
    sessionId: RELEASE.sessionId,
  });
  expect(hint.line).toBe("Lagebuch: 1 neuer Eintrag (Der Testserver heißt staging-2)");
  expect(hint.line).not.toContain("Urlaub");
});

it("drops the oldest entries when the limit is reached and keeps the newest", async () => {
  const world = logbookWorld([TEAM], settings({ limit: 10 }));
  for (let index = 1; index <= 13; index += 1)
    await remember(world, TEAM, "notiz", `Eintrag ${String(index)}`);

  expect(world.logbook.entries).toHaveLength(10);
  expect(world.logbook.entries.map((entry) => entry.text)).toEqual(
    Array.from({ length: 10 }, (_, index) => `Eintrag ${String(index + 4)}`),
  );
  // Lowering the limit drops the oldest at once.
  world.logbook.settingsOf.set(AGENT, settings({ limit: 5 }));
  expect(await world.service.trim(AGENT)).toBe(5);
  expect(world.logbook.entries.map((entry) => entry.text)).toEqual([
    "Eintrag 9",
    "Eintrag 10",
    "Eintrag 11",
    "Eintrag 12",
    "Eintrag 13",
  ]);
});

it("asks for the compaction at about 80 % when dreaming is on, not before and not twice at once", async () => {
  const world = logbookWorld([TEAM], settings({ limit: 10 }));
  expect(AGENT_LOGBOOK_COMPACTION_PERCENT).toBe(80);

  for (let index = 1; index <= 7; index += 1)
    await remember(world, TEAM, "notiz", `Eintrag ${String(index)}`);
  expect(world.compaction).not.toHaveBeenCalled();

  await remember(world, TEAM, "notiz", "Eintrag 8");
  expect(world.compaction).toHaveBeenCalledTimes(1);
  expect(world.compaction).toHaveBeenCalledWith(AGENT);
  expect(world.logbook.settingsOf.get(AGENT)?.compactionAt).toBe(
    "2026-11-13T17:05:00.000Z",
  );

  // Entries beyond 80 % inside the cooldown do not ask again.
  await remember(world, TEAM, "notiz", "Eintrag 9");
  await remember(world, TEAM, "notiz", "Eintrag 10");
  await remember(world, TEAM, "notiz", "Eintrag 11");
  expect(world.compaction).toHaveBeenCalledTimes(1);
  // The oldest still dropped out meanwhile.
  expect(world.logbook.entries).toHaveLength(10);

  // After the cooldown a Lagebuch that is still full asks again.
  world.advance(61);
  await remember(world, TEAM, "notiz", "Eintrag 12");
  expect(world.compaction).toHaveBeenCalledTimes(2);
});

it("asks for no compaction when the agent has dreaming switched off or no model can run it", async () => {
  const off = logbookWorld([TEAM], settings({ limit: 10 }));
  off.isLearningEnabled.value = false;
  for (let index = 1; index <= 10; index += 1)
    await remember(off, TEAM, "notiz", `Eintrag ${String(index)}`);
  expect(off.compaction).not.toHaveBeenCalled();
  expect(off.logbook.entries).toHaveLength(10);
});

it("tells a round in one line what other chats wrote since the stand of its session", async () => {
  const world = logbookWorld();
  const team = { agentId: AGENT, sessionId: TEAM.sessionId };

  // Nothing written yet: no line.
  expect(await world.service.hint(team)).toEqual({ line: null, newest: 0 });

  await remember(world, IGOR, "entscheidung", "PAGE-370 übernimmt Ed bis Freitag.");
  await remember(world, RELEASE, "aufgabe", "Release Freitag vorbereiten");
  await remember(world, IGOR, "fakt", "Testserver ist staging-2");

  const hint = await world.service.hint(team);
  expect(hint.line).toBe(
    "Lagebuch: 3 neue Einträge (Testserver ist staging-2, Release Freitag vorbereiten, PAGE-370 übernimmt Ed bis Freitag)",
  );
  expect(hint.newest).toBe(3);
  // One line, and none of the entry texts beyond their topics.
  expect(hint.line?.split("\n")).toHaveLength(1);
});

it("leaves the line out once the session was told, and counts only entries of other chats", async () => {
  const world = logbookWorld();
  const team = { agentId: AGENT, sessionId: TEAM.sessionId };
  await remember(world, IGOR, "fakt", "Erster Fakt");

  const first = await world.service.hint(team);
  expect(first.line).toBe("Lagebuch: 1 neuer Eintrag (Erster Fakt)");
  await world.service.markSeen(TEAM.sessionId, first.newest);

  // Same stand, no news: no line.
  expect(await world.service.hint(team)).toEqual({ line: null, newest: 1 });

  // The session's own chat writing is no news for it ...
  await remember(world, TEAM, "fakt", "Eigener Fakt");
  const own = await world.service.hint(team);
  expect(own.line).toBeNull();
  expect(own.newest).toBe(2);
  await world.service.markSeen(TEAM.sessionId, own.newest);

  // ... but another chat's entry is, and only that one.
  await remember(world, RELEASE, "frage", "Neue Frage");
  expect((await world.service.hint(team)).line).toBe(
    "Lagebuch: 1 neuer Eintrag (Neue Frage)",
  );
  // The stand of one session says nothing about another: the direct chat has
  // seen nothing yet, and its own first entry is no news for it.
  expect(
    (await world.service.hint({ agentId: AGENT, sessionId: IGOR.sessionId })).line,
  ).toBe("Lagebuch: 2 neue Einträge (Neue Frage, Eigener Fakt)");
});

it("does not put the text of the Lagebuch into a round, only the short topics", async () => {
  const world = logbookWorld();
  await remember(
    world,
    IGOR,
    "aufgabe",
    "Release Freitag vorbereiten. Mei schreibt die Notizen bis Mittwoch und Ed prüft den Testserver.",
  );
  await remember(world, IGOR, "fakt", "x".repeat(480));
  const hint = await world.service.hint({
    agentId: AGENT,
    sessionId: TEAM.sessionId,
  });
  expect(hint.line).toContain("Release Freitag vorbereiten");
  expect(hint.line).not.toContain("Notizen");
  expect(hint.line).not.toContain("Testserver");
  // However long the entries are, the line stays short.
  expect(Array.from(hint.line ?? "").length).toBeLessThan(140);
});

it("names at most three topics and says that there are more", async () => {
  const world = logbookWorld();
  for (let index = 1; index <= 5; index += 1)
    await remember(world, IGOR, "notiz", `Thema ${String(index)}`);
  expect(
    (await world.service.hint({ agentId: AGENT, sessionId: TEAM.sessionId })).line,
  ).toBe("Lagebuch: 5 neue Einträge (Thema 5, Thema 4, Thema 3, …)");
});

it("never moves the stand of a session backward and ignores an empty Lagebuch", async () => {
  const world = logbookWorld();
  await world.service.markSeen(TEAM.sessionId, 7);
  await world.service.markSeen(TEAM.sessionId, 3);
  await world.service.markSeen(TEAM.sessionId, 0);
  expect(world.seen.get(TEAM.sessionId)).toBe(7);
});

it("keeps the entries of every agent apart", async () => {
  const world = logbookWorld();
  world.logbook.settingsOf.set("other", settings());
  await remember(world, TEAM, "fakt", "Nur für Ed.");
  const other = world.service.tools({ agentId: "other", sessionId: TEAM.sessionId });
  expect(await other.search({ text: "Ed" })).toMatchObject({ eintraege: [] });
  expect(FakeLogbook.key({ kind: "group", id: "g" })).toBe("group:g");
});
