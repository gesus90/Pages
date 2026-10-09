import { describe, expect, it, vi } from "vitest";

import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";
import { WorkItemNotFoundError } from "@/backend/error/WorkItemErrors";
import { WorkItemLifecycleRepository } from "@/backend/database/repositories/task/WorkItemLifecycleRepository";

import { createAccess, createRole } from "../helpers/authorization";
import { createCatalogModel } from "../helpers/agents";
import {
  assistantRequest,
  createAssistantHarness,
} from "../helpers/text-assistant";
import { pageInput } from "../helpers/wiki-harness";
import { useMigratedDatabase } from "../helpers/test-database";

import type { TextAssistantResult } from "@/definition/TextAssistant";

function deferredText(): {
  readonly promise: Promise<string>;
  readonly resolve: (text: string) => void;
} {
  let finish: (text: string) => void = () => {
    throw new Error("Uninitialized synthetic promise");
  };
  const promise = new Promise<string>((resolve) => {
    finish = resolve;
  });
  return { promise, resolve: finish };
}

describe("text assistance with real policies and private persistence", () => {
  const getDatabase = useMigratedDatabase();

  it("opening reads defaults without creating a conversation or generating/writing text", async () => {
    const { service, alice, request, execution } =
      await createAssistantHarness(getDatabase());
    expect(await service.history(alice, request.context)).toEqual({
      conversations: [],
      preferences: { autoApply: false, targetLanguage: "de" },
    });
    expect(execution.run).not.toHaveBeenCalled();
    expect(
      await getDatabase().query(
        "SELECT COUNT(*) FROM assistant_conversations;",
      ),
    ).toEqual([[0]]);
  });

  it("uses the role snapshot for wiki and ticket actions without modifying document or metadata", async () => {
    const { service, alice, request, execution, wiki, page } =
      await createAssistantHarness(getDatabase());
    const before = await getDatabase().query(
      "SELECT title, description, status_id, parent_id FROM work_items WHERE id = 'ticket';",
    );
    const result = await service.run(alice, request);
    expect(result).toMatchObject({
      text: "Corrected passage",
      change: "replace",
      context: request.context,
    });
    expect(execution.run).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({
          model: "model-a",
          reasoningEffort: "medium",
        }),
      }),
      expect.any(AbortSignal),
    );
    const prompt = execution.run.mock.calls[0][0].prompt;
    expect(prompt).toContain(request.source);
    expect(prompt).not.toContain(page.content);
    expect(prompt).not.toContain("synthetic-ciphertext");
    const ticketRequest = assistantRequest({
      context: { kind: "ticket", id: "ticket", version: "" },
      scope: "document",
      source: "",
      action: "generate",
      change: "insert",
      instruction: "Write a description",
    });
    await service.run(alice, ticketRequest);
    expect((await wiki.service.read(alice, page.id)).kind).toBe("page");
    expect(
      await getDatabase().query(
        "SELECT content, revision FROM wiki_pages WHERE id = $id;",
        { id: page.id },
      ),
    ).toEqual([[page.content, 1]]);
    expect(
      await getDatabase().query(
        "SELECT title, description, status_id, parent_id FROM work_items WHERE id = 'ticket';",
      ),
    ).toEqual(before);
  });

  it("allows read-only questions but refuses edits, hidden contexts, archived tickets and changed versions", async () => {
    const harness = await createAssistantHarness(getDatabase());
    const { service, alice, reader, request, wiki } = harness;
    await expect(service.run(reader, request)).rejects.toThrow("accessDenied");
    const question = assistantRequest({
      ...request,
      action: "explain",
      change: "answer",
    });
    await expect(service.run(reader, question)).resolves.toMatchObject({
      change: "answer",
    });
    const privatePage = await wiki.service.create(
      alice,
      pageInput({ scope: "private" }),
    );
    await expect(
      service.run(
        reader,
        assistantRequest({
          ...question,
          context: { kind: "wiki", id: privatePage.id, version: "1" },
        }),
      ),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    await expect(
      service.run(
        alice,
        assistantRequest({
          ...question,
          context: { kind: "ticket", id: "missing", version: "" },
        }),
      ),
    ).rejects.toBeInstanceOf(WorkItemNotFoundError);
    await expect(
      service.validate(alice, {
        ...request,
        context: { ...request.context, version: "0" },
      }),
    ).rejects.toThrow("versionConflict");
    await getDatabase().execute(
      "UPDATE work_items SET archived_at = utc_now() WHERE id = 'ticket';",
    );
    await expect(
      service.run(
        alice,
        assistantRequest({
          context: { kind: "ticket", id: "ticket", version: "" },
        }),
      ),
    ).rejects.toThrow("accessDenied");
  });

  it("never reads other users' history, including administrators, and supports new/reopened/deleted conversations", async () => {
    const { service, alice, bob, request, authorization, admin } =
      await createAssistantHarness(getDatabase());
    const result = await service.run(alice, request);
    expect(
      (await service.history(alice, request.context)).conversations,
    ).toHaveLength(1);
    const messages = await service.messages(
      alice,
      request.context,
      result.conversationId,
    );
    expect(messages.map((entry) => entry.role)).toEqual(["user", "assistant"]);
    await authorization.saveAccount(
      createAccess({
        ...admin,
        userId: bob.id,
        role: createRole({ id: "role-bob" }),
      }),
    );
    expect((await service.history(bob, request.context)).conversations).toEqual(
      [],
    );
    await expect(
      service.messages(bob, request.context, result.conversationId),
    ).rejects.toThrow("conversationMissing");
    await service.remove(bob, result.conversationId);
    expect(
      await service.messages(alice, request.context, result.conversationId),
    ).toHaveLength(2);
    const continued = await service.run(
      alice,
      assistantRequest({
        ...request,
        conversationId: result.conversationId,
        instruction: "Another explicit request",
      }),
    );
    expect(continued.conversationId).toBe(result.conversationId);
    expect(
      await service.messages(alice, request.context, result.conversationId),
    ).toHaveLength(4);
    const separate = await service.run(alice, assistantRequest({ ...request }));
    expect(separate.conversationId).not.toBe(result.conversationId);
    await service.remove(alice, result.conversationId);
    await expect(
      service.messages(alice, request.context, result.conversationId),
    ).rejects.toThrow("conversationMissing");
    expect(
      await getDatabase().query(
        "SELECT COUNT(*) FROM assistant_messages WHERE conversation_id = $id;",
        { id: result.conversationId },
      ),
    ).toEqual([[0]]);
  });

  it("keeps role/context configuration fixed while running and rejects a changed saved version", async () => {
    const { service, alice, request, execution, connections, roles, admin } =
      await createAssistantHarness(getDatabase());
    const delayed = deferredText();
    execution.run.mockReturnValueOnce(delayed.promise);
    const pending = service.run(alice, request);
    await vi.waitFor(() => expect(execution.run).toHaveBeenCalled());
    await connections.catalogs().save(
      "connection",
      {
        attemptedAt: "2026-10-09T13:00:00Z",
        errorCode: null,
        models: [
          createCatalogModel({
            id: "model-a",
            reasoning: "levels",
            reasoningEfforts: ["medium"],
          }),
          createCatalogModel({ id: "model-b" }),
        ],
      },
      null,
    );
    await roles.save(admin, {
      role: {
        connectionId: "connection",
        model: "model-b",
        reasoningEffort: null,
      },
      retentionDays: 30,
    });
    delayed.resolve("Pinned result");
    expect(await pending).toMatchObject({
      text: "Pinned result",
      context: request.context,
    });
    expect(execution.run.mock.calls[0][0].agent.model).toBe("model-a");
    await service.run(alice, assistantRequest({ ...request }));
    expect(execution.run.mock.calls[1][0].agent.model).toBe("model-b");
    const changed = deferredText();
    execution.run.mockReturnValueOnce(changed.promise);
    const old = service.run(alice, assistantRequest({ ...request }));
    await vi.waitFor(() => expect(execution.run).toHaveBeenCalledTimes(3));
    await getDatabase().execute(
      "UPDATE wiki_pages SET revision = revision + 1 WHERE id = $id;",
      { id: request.context.id },
    );
    changed.resolve("Outdated result");
    await expect(old).rejects.toThrow("versionConflict");
    expect(
      await getDatabase().query(
        "SELECT COUNT(*) FROM assistant_messages WHERE content = 'Outdated result';",
      ),
    ).toEqual([[0]]);
  });

  it("cancelled, invalid, failed or deleted conversations cannot become successful turns", async () => {
    const { service, alice, bob, request, execution, conversations } =
      await createAssistantHarness(getDatabase());
    const delayed = deferredText();
    execution.run.mockReturnValueOnce(delayed.promise);
    const pending = service.run(alice, request);
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(execution.run).toHaveBeenCalled());
    service.cancel(bob, request.requestId);
    service.cancel(alice, request.requestId);
    delayed.resolve("Partial text");
    await rejected;
    expect(
      await getDatabase().query("SELECT COUNT(*) FROM assistant_messages;"),
    ).toEqual([[0]]);
    for (const output of ["", "x".repeat(200_001)]) {
      execution.run.mockResolvedValueOnce(output);
      await expect(
        service.run(alice, assistantRequest({ ...request })),
      ).rejects.toThrow("invalidOutput");
    }
    execution.run.mockRejectedValueOnce(
      new TextAssistantError("providerFailed"),
    );
    await expect(
      service.run(alice, assistantRequest({ ...request })),
    ).rejects.toThrow("providerFailed");
    const initial: TextAssistantResult = await service.run(
      alice,
      assistantRequest({ ...request }),
    );
    const removed = deferredText();
    execution.run.mockReturnValueOnce(removed.promise);
    const late = service.run(
      alice,
      assistantRequest({ ...request, conversationId: initial.conversationId }),
    );
    await vi.waitFor(() => expect(execution.run).toHaveBeenCalledTimes(6));
    await conversations.remove(alice.id, initial.conversationId);
    removed.resolve("Deleted turn");
    await expect(late).rejects.toThrow("conversationMissing");
    execution.run.mockResolvedValueOnce("api_key=syntheticcredential");
    const redacted = await service.run(alice, assistantRequest({ ...request }));
    expect(redacted.text).toBe("[redacted]");
    expect(
      JSON.stringify(await conversations.messages(redacted.conversationId)),
    ).not.toContain("syntheticcredential");
  });

  it("applies the current retention to existing histories and removes histories with deleted pages/tickets", async () => {
    const { service, alice, request, conversations, roles, admin, wiki } =
      await createAssistantHarness(getDatabase());
    const first = await service.run(alice, request);
    await getDatabase().execute(
      "UPDATE assistant_conversations SET last_message_at = utc_after(-INTERVAL 29 DAY);",
    );
    await conversations.sweep();
    expect(await conversations.list(alice.id, request.context)).toHaveLength(1);
    await roles.save(admin, {
      ...(await roles.read(admin)),
      retentionDays: 28,
    });
    await conversations.sweep();
    expect(await conversations.list(alice.id, request.context)).toEqual([]);
    await service.run(alice, assistantRequest({ ...request }));
    await wiki.service.delete(alice, request.context.id);
    expect(await conversations.list(alice.id, request.context)).toEqual([]);
    await expect(
      conversations.append(first.conversationId, {
        instruction: "late",
        text: "late",
        change: "answer",
      }),
    ).rejects.toThrow("conversationMissing");
    const ticketRequest = assistantRequest({
      context: { kind: "ticket", id: "ticket", version: "" },
    });
    const ticket = await service.run(alice, ticketRequest);
    await new WorkItemLifecycleRepository(getDatabase()).deleteSubtree(
      "ticket",
    );
    expect(await conversations.messages(ticket.conversationId)).toEqual([]);
  });

  it("requires active users for every public operation and drains shutdown", async () => {
    const { service, alice, request } =
      await createAssistantHarness(getDatabase());
    for (const actor of [
      { ...alice, isActive: false },
      { ...alice, mustChangePassword: true },
    ]) {
      expect(() => service.run(actor, request)).toThrow("accessDenied");
      await expect(service.validate(actor, request)).rejects.toThrow(
        "accessDenied",
      );
      await expect(service.history(actor, request.context)).rejects.toThrow(
        "accessDenied",
      );
      await expect(service.remove(actor, "history")).rejects.toThrow(
        "accessDenied",
      );
      await expect(service.savePreferences(actor, {})).rejects.toThrow(
        "accessDenied",
      );
      expect(() => service.cancel(actor, "request")).toThrow("accessDenied");
    }
    await service.shutdown();
    await expect(service.run(alice, request)).rejects.toThrow("requestBusy");
  });
});
