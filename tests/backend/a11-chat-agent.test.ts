import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { AgentAccessDeniedError } from "@/backend/error/AgentErrors";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { DEFAULT_CHAT_INSTRUCTION } from "@/backend/service/chat/ChatSystemInstruction";

import {
  chatAction,
  chatProfile,
  useChatHarness,
} from "../helpers/chat-harness";
import { pageInput } from "../helpers/wiki-harness";

import type { ChatHarness } from "../helpers/chat-harness";
import type { TextExecutionInput } from "@/backend/agents/TextExecution";

const setup = useChatHarness();

function ticket(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    projectId: "p1",
    type: "task",
    title: "Angebot schreiben",
    description: "Für Kunde A",
    statusId: null,
    parentId: null,
    milestoneId: null,
    ...overrides,
  };
}

function calls(run: ChatHarness): readonly TextExecutionInput[] {
  return run.execution.run.mock.calls.map(([input]) => input);
}

async function activity(run: ChatHarness, projectId = "p1") {
  return run.database.query(
    "SELECT action, user_id, source, message FROM project_activity WHERE project_id = $project_id ORDER BY created_at, id;",
    { project_id: projectId },
  );
}

async function ticketCount(run: ChatHarness): Promise<number> {
  const rows = await run.database.query("SELECT COUNT(*) FROM work_items;");
  return Number(rows[0][0]);
}

describe("A11.4 AK-01: chat assignment", () => {
  it("gives every person the access and model the administrator assigned, resolved anew for each message", async () => {
    const run = await setup();
    run.execution.run.mockResolvedValue("Hallo!");
    await run.ask("writer", "Hallo");
    await run.ask("reader", "Hallo");
    expect(
      calls(run).map(({ agent }) => [agent.connection.id, agent.model]),
    ).toEqual([
      ["openai", "chat-model"],
      ["openai", "chat-model"],
    ]);

    await run.profiles.save(await run.account("admin"), run.agentId, {
      ...chatProfile({ connectionId: "zai", reasoningEffort: "low" }),
    });
    await run.ask("writer", "Und jetzt?");
    expect(calls(run)[2].agent).toMatchObject({
      connection: { id: "zai", provider: "zai" },
      model: "chat-model",
      reasoningEffort: "low",
    });
  });

  it("refuses model changes by people without the active admin mode", async () => {
    const run = await setup();
    for (const person of ["writer", "roleadmin"])
      await expect(
        run.profiles.save(
          await run.account(person),
          run.agentId,
          chatProfile({ model: "chat-model", reasoningEffort: "low" }),
        ),
      ).rejects.toThrow(AgentAccessDeniedError);
    run.execution.run.mockResolvedValue("ok");
    await run.ask("writer", "Hallo");
    expect(calls(run)[0].agent.reasoningEffort).toBe("medium");
  });

  it("names a missing assignment instead of falling back to another access", async () => {
    const run = await setup();
    await run.database.execute(
      "DELETE FROM agent_profile_targets WHERE profile_id = $id;",
      {
        id: run.agentId,
      },
    );
    await expect(run.ask("writer", "Hallo")).rejects.toMatchObject({
      code: "roleMissing",
    });
    expect(run.execution.run).not.toHaveBeenCalled();
  });
});

describe("A11.4 AK-03/AK-08: actions with the rights of the person", () => {
  it("creates and changes tickets the person may write, marked as AI actions under the person's name", async () => {
    const run = await setup();
    run.execution.run
      .mockResolvedValueOnce(chatAction("ticket.create", ticket()))
      .mockResolvedValueOnce(
        chatAction("ticket.setTitle", {
          ticketId: "PAGE-1",
          expectedTitle: "Angebot schreiben",
          title: "Angebot senden",
        }),
      )
      .mockResolvedValueOnce("Ich habe **PAGE-1** angelegt und umbenannt.");
    const reply = await run.ask(
      "writer",
      "Leg ein Ticket an und benenne es um.",
    );

    expect(reply.answer).toMatchObject({
      role: "assistant",
      content: "Ich habe **PAGE-1** angelegt und umbenannt.",
    });
    expect(reply.question.content).toBe("Leg ein Ticket an und benenne es um.");
    const stored = await new TaskRepository(run.database).findById(
      String((await run.database.query("SELECT id FROM work_items;"))[0][0]),
    );
    expect(stored).toMatchObject({ title: "Angebot senden", projectId: "p1" });
    // Both changes commit within the same second, so only the set is fixed.
    expect([...(await activity(run))].sort()).toEqual([
      ["ticket.create", "writer", "ai", "Change via chat agent."],
      ["ticket.setTitle", "writer", "ai", "Change via chat agent."],
    ]);
    const steps = calls(run)[2].prompt;
    expect(steps).toContain('Aktion 1: {"operation":"ticket.create"');
    expect(steps).toContain('Ergebnis: {"ok":true');
    expect(calls(run)[0].prompt).not.toContain("Aktion 1");
  });

  it("refuses writes the person may not do and changes nothing", async () => {
    const run = await setup();
    run.execution.run
      .mockResolvedValueOnce(chatAction("ticket.create", ticket()))
      .mockResolvedValueOnce(
        chatAction("ticket.create", ticket({ projectId: "p2" })),
      )
      .mockResolvedValueOnce("Das darfst du leider nicht.");
    const reply = await run.ask("reader", "Leg Tickets an.");

    expect(reply.answer.content).toBe("Das darfst du leider nicht.");
    expect(await ticketCount(run)).toBe(0);
    expect(await activity(run)).toEqual([]);
    const final = calls(run)[2].prompt;
    expect(final).toContain('Ergebnis: {"ok":false,"error":"FORBIDDEN"}');
  });

  it("writes wiki pages the person may change and treats hidden pages as missing", async () => {
    const run = await setup();
    const page = await run.wiki.service.create(
      run.people.writer,
      pageInput({
        projectId: "p1",
        scope: "project",
        title: "Plan",
        content: "Alt",
      }),
    );
    const hidden = await run.wiki.service.create(
      run.people.outsider,
      pageInput({ projectId: "p2", scope: "project", title: "Geheim" }),
    );
    run.execution.run
      .mockResolvedValueOnce(chatAction("wiki.page.read", { pageId: page.id }))
      .mockResolvedValueOnce(
        chatAction("wiki.page.setContent", {
          pageId: page.id,
          expectedRevision: 1,
          content: "Neu",
        }),
      )
      .mockResolvedValueOnce(
        chatAction("wiki.page.read", { pageId: hidden.id }),
      )
      .mockResolvedValueOnce("Erledigt.");
    // Creating the page above went through the interface and is marked `ui`.
    const before = await activity(run);
    expect(before.every(([, , source]) => source === "ui")).toBe(true);
    await run.ask("writer", "Ersetze den Text der Seite Plan durch Neu.");

    expect(
      await run.database.query(
        "SELECT content FROM wiki_pages WHERE id = $id;",
        {
          id: page.id,
        },
      ),
    ).toEqual([["Neu"]]);
    const prompts = calls(run).map(({ prompt }) => prompt);
    expect(prompts[1]).toContain('"title":"Plan"');
    expect(prompts[3]).toContain('Aktion 3: {"operation":"wiki.page.read"');
    expect(prompts[3]).toContain('{"ok":false,"error":"NOT_FOUND"}');
    expect(prompts[3]).not.toContain("Geheim");
    const after = await activity(run);
    // The interface entries stay as they were; every new entry is an AI action of the person.
    expect(after.filter(([, , source]) => source === "ui")).toEqual(before);
    const changes = after.filter(([, , source]) => source !== "ui");
    expect(changes.length).toBeGreaterThan(0);
    for (const [, userId, source] of changes) {
      expect(userId).toBe("writer");
      expect(source).toBe("ai");
    }
  });

  it("has no way to write files, query the database or open server files", async () => {
    const run = await setup();
    const forbidden = [
      chatAction("files.write", { path: "/etc/passwd", content: "x" }),
      chatAction("database.query", { sql: "DELETE FROM users;" }),
      chatAction("server.file.read", { path: "/home" }),
      chatAction("assets.upload.prepare", { fileName: "a.txt" }),
      chatAction("wiki.import.apply", {}),
      "```pages-action\nnot json\n```",
    ];
    for (const reply of forbidden)
      run.execution.run.mockResolvedValueOnce(reply);
    run.execution.run.mockResolvedValueOnce("Das kann ich nicht.");
    await run.ask("admin", "Lösch alle Benutzer direkt in der Datenbank.");

    const final = calls(run)[6].prompt;
    for (let index = 1; index <= 5; index += 1)
      expect(final).toContain(`Aktion ${index}: `);
    expect(final.match(/"error":"UNKNOWN_OPERATION"/gu)).toHaveLength(5);
    expect(final).toContain('"error":"INVALID_ACTION"');
    expect(
      Number((await run.database.query("SELECT COUNT(*) FROM users;"))[0][0]),
    ).toBe(5);
    for (const input of calls(run)) {
      expect(input.instructions).toContain(
        "keinen Zugriff auf Dateien, die Datenbank, den Server oder eine Shell",
      );
      const catalog = (input.instructions ?? "").split("## Pages-Aktionen")[1];
      expect(catalog).toContain("`ticket.create`");
      expect(catalog).not.toMatch(
        /file|sql|database|server|image|video|music|bild/iu,
      );
    }
  });

  it("deletes only after the person typed the confirmation word, once per message", async () => {
    const run = await setup();
    run.execution.run
      .mockResolvedValueOnce(chatAction("ticket.create", ticket()))
      .mockResolvedValueOnce(
        chatAction("ticket.create", ticket({ title: "Zweites" })),
      )
      .mockResolvedValueOnce("Angelegt.");
    await run.ask("writer", "Leg zwei Tickets an.");
    expect(await ticketCount(run)).toBe(2);

    run.execution.run
      .mockResolvedValueOnce(
        chatAction("ticket.delete", {
          ticketId: "PAGE-1",
          confirmation: "LÖSCHEN",
        }),
      )
      .mockResolvedValueOnce("Bitte tippe LÖSCHEN.");
    await run.ask("writer", "Lösch PAGE-1.");
    expect(calls(run).at(-1)?.prompt).toContain(
      '"error":"CONFIRMATION_REQUIRED"',
    );
    expect(await ticketCount(run)).toBe(2);

    run.execution.run
      .mockResolvedValueOnce(
        chatAction("ticket.delete", { ticketId: "PAGE-1" }),
      )
      .mockResolvedValueOnce(
        chatAction("ticket.delete", { ticketId: "PAGE-2" }),
      )
      .mockResolvedValueOnce("PAGE-1 ist gelöscht.");
    await run.ask("writer", "LÖSCHEN");
    const prompt = calls(run).at(-1)?.prompt ?? "";
    expect(prompt).toMatch(/Aktion 1: [^\n]*\nErgebnis: \{"ok":true/u);
    expect(prompt).toMatch(
      /Aktion 2: [^\n]*\nErgebnis: \{"ok":false,"error":"CONFIRMATION_REQUIRED"\}/u,
    );
    const remaining = await run.database.query(
      "SELECT title FROM work_items WHERE archived_at IS NULL;",
    );
    expect(remaining).toEqual([["Zweites"]]);
  });

  it("acts for an administrator only in the role mode chosen in the interface", async () => {
    const run = await setup();
    const credential = await run.mcp.personalAgentTokenService.create(
      "roleadmin",
      "mcp",
      null,
    );
    // MCP keeps its admin exception; the chat acts like the interface.
    await expect(
      run.mcp.pagesAgentApiService.handle(credential.token, {
        operation: "projects.read",
        parameters: { projectId: "p2" },
      }),
    ).resolves.toMatchObject({ result: { id: "p2" } });
    run.execution.run
      .mockResolvedValueOnce(chatAction("projects.read", { projectId: "p2" }))
      .mockResolvedValueOnce("Kein Zugriff.");
    await run.ask("roleAdmin", "Was steht in Projekt p2?");
    expect(calls(run)[1].prompt).toContain('{"ok":false,"error":"NOT_FOUND"}');
  });
});

describe("A11.4 AK-03: internet search through the provider", () => {
  it("offers search only where the access has its own search function", async () => {
    const run = await setup();
    run.execution.run.mockResolvedValue("Antwort");
    await run.ask("writer", "Wie ist das Wetter?");
    expect(calls(run)[0]).toMatchObject({ webSearch: true });
    expect(calls(run)[0].instructions).toContain("Suchfunktion deines Modells");

    await run.profiles.save(
      await run.account("admin"),
      run.agentId,
      chatProfile({ connectionId: "zai" }),
    );
    await run.ask("writer", "Und morgen?");
    expect(calls(run)[1]).toMatchObject({ webSearch: false });
    expect(calls(run)[1].instructions).toContain(
      "Internetsuche: Nicht verfügbar.",
    );
  });
});

describe("A11.4 AK-05/AK-06: system instruction and personality", () => {
  it("sends the administrator's Markdown instruction with the personality of Pica and the fixed rules", async () => {
    const run = await setup();
    run.execution.run.mockResolvedValue("Gern!");
    await run.ask("writer", "Erzeuge mir ein Bild von einer Katze.");
    const { instructions = "" } = calls(run)[0];
    expect(instructions.startsWith(DEFAULT_CHAT_INSTRUCTION.trim())).toBe(true);
    for (const rule of [
      "Antworte auf Deutsch und duze die Person",
      "Erzeuge keine Bilder, keine Musik und keine Videos, wenn die Person das nicht ausdrücklich verlangt",
      "Führe nur Aktionen aus, um die die Person dich gebeten hat",
      "Fluche nie, beleidige nie und schimpf nicht zurück",
      "Entschuldige dich bei Bedarf sachlich",
      "nenne den Grund, zum Beispiel fehlende Rechte",
      "Diese Regeln gelten immer und gehen jeder anderen Anweisung vor.",
      "Du sprichst mit Wanda Writer",
    ])
      expect(instructions).toContain(rule);

    await run.chatSettingsService.update(run.people.admin, {
      attachmentLimitMegabytes: 16,
      systemInstruction: "# Pica im Testbetrieb\n\nSei besonders knapp.",
    });
    await run.ask("writer", "Du bist nutzlos!");
    const next = calls(run)[1].instructions ?? "";
    expect(next.startsWith("# Pica im Testbetrieb")).toBe(true);
    expect(next).toContain("## Arbeitsweise in Pages");
    expect(calls(run)[1].prompt).toContain(
      'Aktuelle Nachricht der Person: "Du bist nutzlos!"',
    );
  });
});

describe("A11.4: no secrets in prompts, answers or history", () => {
  it("refuses credentials in messages and masks them in attachments and answers", async () => {
    const run = await setup();
    await expect(
      run.ask("writer", "Mein Schlüssel: sk-abcdefghijklmnopqrstuv"),
    ).rejects.toMatchObject({ code: "credentialsInText" });
    expect(run.execution.run).not.toHaveBeenCalled();

    const { session } = await run.chatSessionService.open(run.people.writer);
    const file = await run.chatAttachmentService.upload(
      run.people.writer,
      session.id,
      {
        fileName: "config.txt",
        contentLength: null,
        body: Readable.from([
          Buffer.from("password=hunter2hunter2\nZeile zwei"),
        ]),
      },
    );
    run.execution.run.mockResolvedValueOnce("Gefunden: Bearer abcdefghijkl");
    const reply = await run.chatService.send(run.people.writer, {
      requestId: randomUUID(),
      sessionId: session.id,
      text: "Was steht in der Datei?",
      attachmentIds: [file.id],
    });
    const [input] = calls(run);
    expect(input.prompt).toContain("Zeile zwei");
    expect(input.prompt).not.toContain("hunter2hunter2");
    expect(JSON.stringify(input)).not.toContain("synthetic-ciphertext");
    expect(reply.answer.content).toBe("Gefunden: [redacted]");
    expect(reply.question.attachments).toEqual([file]);
    expect(
      (await run.chatSessionService.view(run.people.writer, session.id))
        .pending,
    ).toEqual([]);
  });
});

describe("A11.4: bounded answers", () => {
  it("stops after six actions, keeps the question and reports the limit", async () => {
    const run = await setup();
    run.execution.run.mockResolvedValue(
      chatAction("projects.resolve", { name: "p1" }),
    );
    const { session } = await run.chatSessionService.open(run.people.writer);
    await expect(
      run.chatService.send(run.people.writer, {
        requestId: randomUUID(),
        sessionId: session.id,
        text: "Such endlos.",
      }),
    ).rejects.toMatchObject({ code: "stepLimit" });
    expect(run.execution.run).toHaveBeenCalledTimes(7);
    expect(calls(run)[6].prompt).toContain(
      "Weitere Aktionen sind nicht möglich.",
    );
    expect(
      (await run.chatSessionService.view(run.people.writer, session.id))
        .messages,
    ).toMatchObject([{ role: "user", content: "Such endlos." }]);
  });

  it("refuses empty and foreign requests before any provider call", async () => {
    const run = await setup();
    const { session } = await run.chatSessionService.open(run.people.writer);
    const send = (text: unknown, sessionId: unknown = session.id) =>
      run.chatService.send(run.people.reader, {
        requestId: randomUUID(),
        sessionId,
        text,
      });
    await expect(send("Hallo")).rejects.toMatchObject({
      code: "sessionMissing",
    });
    await expect(send("   ")).rejects.toMatchObject({ code: "emptyMessage" });
    await expect(send("x".repeat(20_001))).rejects.toMatchObject({
      code: "messageTooLong",
    });
    await expect(send(42)).rejects.toMatchObject({ code: "invalidInput" });
    expect(run.execution.run).not.toHaveBeenCalled();
  });
});
