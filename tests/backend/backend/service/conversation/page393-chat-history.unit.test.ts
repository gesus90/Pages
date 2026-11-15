import { describe, expect, it } from "vitest";

import {
  historyMessageLink,
  historySnippet,
  historyWords,
} from "@/backend/service/conversation/AgentChatHistoryService";
import { createAgentEmployeeInstructions } from "@/backend/service/employee/AgentEmployeeInstructions";
import { AGENT_HISTORY_LIMITS } from "@/definition/AgentChatHistory";
import { agentToolPolicy } from "@/definition/AgentToolGroups";

import { historyWorld, storedMessage } from "./page393-chat-history-world";

const IN_DIRECT = { kind: "direct", personId: "igor" } as const;
const IN_GROUP = {
  kind: "conversation",
  conversationId: "group-team",
} as const;

const GROUP_MESSAGE = storedMessage({
  source: "conversation",
  chatKind: "group",
  chatId: "group-team",
  chatName: "Pages-Team",
  conversationId: "group-team",
  messageId: "group-1",
  position: 41,
  senderName: "Mei",
  createdAt: "2026-10-20T09:00:00.000Z",
  text: "Ruhezeit bleibt bei 11 Stunden, beschlossen.",
});

describe("PAGE-393 verlauf_durchsuchen", () => {
  it("finds an earlier statement and names chat, sender, time and a snippet", async () => {
    const world = historyWorld({ found: [GROUP_MESSAGE, storedMessage()] });
    const hits = await world.service
      .bind("ed", IN_DIRECT)
      .search({ query: "Ruhezeit entschieden" });
    expect(world.search).toHaveBeenCalledWith("ed", IN_DIRECT, {
      words: ["ruhezeit", "entschieden"],
      chat: null,
      sender: null,
      since: null,
      before: null,
      limit: AGENT_HISTORY_LIMITS.hitsDefault * 3,
    });
    // The group message lacks "entschieden" only in this fake; the service
    // checks every word again after masking and drops it.
    expect(hits).toEqual([
      {
        messageId: "message-2",
        chat: { kind: "direct", id: "igor", name: "Chat mit Igor" },
        from: "Igor",
        at: "2026-10-10T08:01:00.000Z",
        snippet: "Wir haben entschieden: die Ruhezeit beträgt 11 Stunden.",
        isThisChat: true,
        link: "/chat?kind=participant&id=ed&message=message-2",
      },
    ]);
  });

  it("links only hits of the chat the job runs in", async () => {
    const world = historyWorld({ found: [GROUP_MESSAGE, storedMessage()] });
    const fromGroup = await world.service
      .bind("ed", IN_GROUP)
      .search({ query: "ruhezeit" });
    expect(
      fromGroup.map((hit) => [hit.messageId, hit.isThisChat, hit.link]),
    ).toEqual([
      ["group-1", true, "/chat?kind=group&id=group-team&message=group-1"],
      ["message-2", false, null],
    ]);
    const withoutChat = await world.service
      .bind("ed", null)
      .search({ query: "ruhezeit" });
    expect(
      withoutChat.every((hit) => hit.link === null && !hit.isThisChat),
    ).toBe(true);
  });

  it("passes the filters of chat, sender and period, the days inclusive in UTC", async () => {
    const world = historyWorld();
    await world.service.bind("ed", IN_DIRECT).search({
      query: "  Ruhezeit   ruhezeit ",
      chat: " Team ",
      from: "Mei",
      since: "2026-10-01",
      until: "2026-10-31",
      limit: 50,
    });
    expect(world.search.mock.calls[0]?.[2]).toEqual({
      words: ["ruhezeit"],
      chat: "Team",
      sender: "Mei",
      since: "2026-10-01T00:00:00.000Z",
      before: "2026-11-01T00:00:00.000Z",
      limit: AGENT_HISTORY_LIMITS.hitsMaximum * 3,
    });
  });

  it("ignores malformed days and searches nothing without words", async () => {
    const world = historyWorld();
    await world.service
      .bind("ed", IN_DIRECT)
      .search({ query: "x", since: "gestern", until: "2026-13-45", chat: " " });
    expect(world.search.mock.calls[0]?.[2]).toMatchObject({
      since: null,
      before: null,
      chat: null,
    });
    expect(
      await world.service.bind("ed", IN_DIRECT).search({ query: "   " }),
    ).toEqual([]);
    expect(world.search).toHaveBeenCalledTimes(1);
  });

  it("keeps credentials masked and never finds a message through a credential", async () => {
    const secret = storedMessage({
      messageId: "secret",
      text: "Ruhezeit-Tool: password: hunter2secret bitte nicht weitergeben",
    });
    const world = historyWorld({ found: [secret] });
    const history = world.service.bind("ed", IN_DIRECT);
    const [hit] = await history.search({ query: "Ruhezeit" });
    expect(hit?.snippet).toContain("[redacted]");
    expect(hit?.snippet).not.toContain("hunter2secret");
    expect(await history.search({ query: "hunter2secret" })).toEqual([]);
  });

  it("returns at most the asked number of hits", async () => {
    const found = Array.from({ length: 12 }, (_, index) =>
      storedMessage({ messageId: `m-${String(index)}` }),
    );
    const hits = await historyWorld({ found })
      .service.bind("ed", IN_DIRECT)
      .search({ query: "Ruhezeit", limit: 3 });
    expect(hits.map((hit) => hit.messageId)).toEqual(["m-0", "m-1", "m-2"]);
  });
});

describe("PAGE-393 verlauf_lesen", () => {
  const excerpt = [
    storedMessage({
      messageId: "message-1",
      position: 1,
      text: "Wie lange ist die Ruhezeit?",
    }),
    storedMessage({ messageId: "message-2", senderName: "Ed" }),
    storedMessage({
      messageId: "message-3",
      position: 3,
      text: "token password=abcdefghijk",
    }),
  ];

  it("reads the messages before and after a hit, the hit marked", async () => {
    const world = historyWorld({ excerpt });
    const read = await world.service
      .bind("ed", IN_DIRECT)
      .read({ messageId: "message-2", before: 1, after: 1 });
    expect(world.around).toHaveBeenCalledWith("ed", IN_DIRECT, {
      messageId: "message-2",
      before: 1,
      after: 1,
    });
    expect(read).toEqual({
      chat: { kind: "direct", id: "igor", name: "Chat mit Igor" },
      isThisChat: true,
      messages: [
        {
          messageId: "message-1",
          from: "Igor",
          at: "2026-10-10T08:01:00.000Z",
          text: "Wie lange ist die Ruhezeit?",
          isHit: false,
          link: "/chat?kind=participant&id=ed&message=message-1",
        },
        expect.objectContaining({
          messageId: "message-2",
          from: "Ed",
          isHit: true,
        }),
        expect.objectContaining({
          messageId: "message-3",
          text: "token [redacted]",
        }),
      ],
    });
  });

  it("bounds the excerpt and reads without links from another chat", async () => {
    const world = historyWorld({ excerpt });
    const read = await world.service
      .bind("ed", IN_GROUP)
      .read({ messageId: "message-2", before: 99, after: -4 });
    expect(world.around.mock.calls[0]?.[2]).toEqual({
      messageId: "message-2",
      before: AGENT_HISTORY_LIMITS.aroundMaximum,
      after: 0,
    });
    expect(read?.isThisChat).toBe(false);
    expect(read?.messages.every((message) => message.link === null)).toBe(true);
    await world.service.bind("ed", IN_GROUP).read({ messageId: "message-2" });
    expect(world.around.mock.calls[1]?.[2]).toMatchObject({
      before: AGENT_HISTORY_LIMITS.aroundDefault,
      after: AGENT_HISTORY_LIMITS.aroundDefault,
    });
  });

  it("answers null for a message the repository does not find visible", async () => {
    const read = await historyWorld({ excerpt })
      .service.bind("ed", IN_DIRECT)
      .read({ messageId: "deleted" });
    expect(read).toBeNull();
  });

  it("shortens a long message of an excerpt", async () => {
    const long = storedMessage({
      text: "a".repeat(AGENT_HISTORY_LIMITS.messageCharacters + 50),
    });
    const read = await historyWorld({ excerpt: [long] })
      .service.bind("ed", IN_DIRECT)
      .read({ messageId: "message-2" });
    expect(read?.messages[0]?.text).toHaveLength(
      AGENT_HISTORY_LIMITS.messageCharacters + 2,
    );
  });
});

describe("PAGE-393 helpers", () => {
  it("splits words without duplicates and at most the limit", () => {
    expect(historyWords("A b a C d e f g h i j")).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
    ]);
  });

  it("cuts a snippet around the first word", () => {
    const text = `${"vorher ".repeat(80)}Ruhezeit 11 Stunden ${"danach ".repeat(80)}`;
    const snippet = historySnippet(text, ["ruhezeit"]);
    expect(snippet.startsWith("… ")).toBe(true);
    expect(snippet.endsWith(" …")).toBe(true);
    expect(snippet).toContain("Ruhezeit 11 Stunden");
    expect(snippet.length).toBeLessThanOrEqual(
      AGENT_HISTORY_LIMITS.snippetCharacters + 4,
    );
    expect(historySnippet("x".repeat(400), ["fehlt"]).startsWith("x")).toBe(
      true,
    );
  });

  it("builds the link a person opens: the agent for a direct chat, the group by its ID", () => {
    expect(
      historyMessageLink("ed", {
        chatKind: "direct",
        chatId: "igor",
        messageId: "m 1",
      }),
    ).toBe("/chat?kind=participant&id=ed&message=m+1");
    expect(
      historyMessageLink("ed", {
        chatKind: "group",
        chatId: "g-1",
        messageId: "m2",
      }),
    ).toBe("/chat?kind=group&id=g-1&message=m2");
  });
});

describe("PAGE-393 instruction of the agents", () => {
  it("tells the agent to search its history for earlier agreements and to link only hits of this chat", () => {
    const text = createAgentEmployeeInstructions({
      name: "Ed",
      position: null,
      roleName: null,
      soul: "",
      instructions: "",
      memory: "",
      dream: "",
      related: [],
      access: "workspace",
      toolPolicy: agentToolPolicy("workspace", []),
      personName: "Igor",
    });
    expect(text).toContain("verlauf_durchsuchen");
    expect(text).toContain("verlauf_lesen");
    expect(text).toContain("Nenne beim Zitieren Chat, Absender und Zeit");
    expect(text).toContain("[Zur Nachricht](link)");
  });
});
