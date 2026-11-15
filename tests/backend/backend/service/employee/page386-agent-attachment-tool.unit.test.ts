import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationError } from "@/backend/error/ConversationError";
import { registerPicaEmployeeTools } from "@/backend/service/chat/PicaEmployeeTools";
import { agentAttachmentTool } from "@/backend/service/employee/AgentAttachmentTool";
import { attachmentToolOf } from "@/backend/service/employee/AgentEmployeeChatTools";

import type { ConversationAttachmentLibrary } from "@/backend/service/conversation/content/ConversationAttachmentLibrary";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function workingFolder(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "page386-"));
  directories.push(directory);
  return directory;
}

function library(): {
  readonly search: ReturnType<
    typeof vi.fn<ConversationAttachmentLibrary["search"]>
  >;
  readonly read: ReturnType<
    typeof vi.fn<ConversationAttachmentLibrary["read"]>
  >;
} {
  return {
    search: vi.fn<ConversationAttachmentLibrary["search"]>().mockResolvedValue({
      hits: [{ kennung: "shot", name: "screenshot.png" }],
      total: 1,
    }),
    read: vi.fn<ConversationAttachmentLibrary["read"]>().mockResolvedValue({
      result: { anhang: { kennung: "shot" }, bildSichtbar: true },
      images: [
        {
          label: "screenshot.png",
          mimeType: "image/png",
          data: Buffer.from("png-bytes"),
        },
      ],
    }),
  };
}

function parsedRecord(raw: string | null | undefined): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw ?? "{}");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("Expected JSON object");
  return parsed as Record<string, unknown>;
}

const signal = new AbortController().signal;

describe("PAGE-386 anhaenge_suchen and anhang_lesen", () => {
  it("searches the chat of the round with the filters of the agent", async () => {
    const attachments = library();
    const tool = agentAttachmentTool(
      { library: attachments },
      { agentId: "ed", conversationId: "group", canSeeImages: true },
    );
    const outcome = await tool(
      "suchen",
      await workingFolder(),
      {
        art: "tabelle",
        absender: "conan",
        stichwort: "Summe",
        von: "2026-11-15",
      },
      signal,
    );
    expect(attachments.search).toHaveBeenCalledWith("ed", "group", {
      kind: "sheet",
      sender: "conan",
      keyword: "Summe",
      since: "2026-11-15",
    });
    expect(outcome.ok).toBe(true);
    expect(parsedRecord(outcome.result)).toMatchObject({
      treffer: [{ kennung: "shot" }],
      gesamt: 1,
    });
  });

  it("writes the images of a reading into the working folder for the model to open", async () => {
    const attachments = library();
    const directory = await workingFolder();
    const tool = agentAttachmentTool(
      { library: attachments },
      { agentId: "ed", conversationId: "group", canSeeImages: true },
    );
    const outcome = await tool("lesen", directory, { kennung: "shot" }, signal);
    expect(attachments.read).toHaveBeenCalledWith(
      "ed",
      { conversationId: "group", key: "shot", request: {} },
      true,
    );
    const result = parsedRecord(outcome.result);
    expect(result.bilder).toEqual([
      {
        datei: path.join(directory, "anhaenge", "shot-1.png"),
        was: "screenshot.png",
      },
    ]);
    expect(
      await readFile(path.join(directory, "anhaenge", "shot-1.png"), "utf8"),
    ).toBe("png-bytes");
    expect(outcome).not.toHaveProperty("images");
  });
});

describe("PAGE-386 attachment tool validation and access control", () => {
  it("passes the parts a reading asks for", async () => {
    const attachments = library();
    attachments.read.mockResolvedValueOnce({ result: {}, images: [] });
    const tool = agentAttachmentTool(
      { library: attachments },
      { agentId: "ed", conversationId: "group", canSeeImages: false },
    );
    await tool(
      "lesen",
      await workingFolder(),
      { kennung: "doc", von: 2, bis: 3, blatt: "Mai", zeileAb: 201, bild: 1 },
      signal,
    );
    expect(attachments.read).toHaveBeenCalledWith(
      "ed",
      {
        conversationId: "group",
        key: "doc",
        request: { from: 2, to: 3, sheet: "Mai", fromRow: 201, image: 1 },
      },
      false,
    );
  });

  it("answers an agent outside the chat or removed from it with a refusal", async () => {
    const attachments = library();
    attachments.read.mockRejectedValueOnce(new ConversationError("not_found"));
    const tool = agentAttachmentTool(
      { library: attachments },
      { agentId: "ed", conversationId: "group", canSeeImages: true },
    );
    const outcome = await tool(
      "lesen",
      await workingFolder(),
      { kennung: "shot" },
      signal,
    );
    expect(outcome).toMatchObject({
      ok: false,
      error: "ATTACHMENT_ACCESS_DENIED",
    });
  });

  it("stays bound to the chat of the round: no other chat, a confidential one included, can be named", async () => {
    const attachments = library();
    const tool = agentAttachmentTool(
      { library: attachments },
      { agentId: "ed", conversationId: "group", canSeeImages: true },
    );
    const read = await tool(
      "lesen",
      await workingFolder(),
      { kennung: "shot", conversationId: "confidential" },
      signal,
    );
    const search = await tool(
      "suchen",
      await workingFolder(),
      { conversationId: "confidential" },
      signal,
    );
    expect(read).toMatchObject({ ok: false });
    expect(search).toMatchObject({ ok: false });
    expect(attachments.read).not.toHaveBeenCalled();
    expect(attachments.search).not.toHaveBeenCalled();
  });

  it("refuses an invalid identifier", async () => {
    const tool = agentAttachmentTool(
      { library: library() },
      { agentId: "ed", conversationId: "group", canSeeImages: true },
    );
    const outcome = await tool(
      "lesen",
      await workingFolder(),
      { kennung: "../../etc/passwd" },
      signal,
    );
    expect(outcome).toMatchObject({
      ok: false,
      error: "ATTACHMENT_READ_FAILED",
    });
  });
});

describe("PAGE-386 attachment tool registration", () => {
  it("binds the tools to the conversation of the round and to what its model sees", async () => {
    const attachments = library();
    expect(
      attachmentToolOf(null, {
        agentId: "ed",
        conversationId: "group",
        assignment: {},
      }),
    ).toEqual({});
    expect(
      attachmentToolOf(
        { library: attachments },
        { agentId: "ed", conversationId: null, assignment: {} },
      ),
    ).toEqual({});
    const blind = attachmentToolOf(
      { library: attachments },
      {
        agentId: "ed",
        conversationId: "group",
        assignment: { supportsImages: false },
      },
    );
    await blind.readAttachments?.(
      "lesen",
      await workingFolder(),
      { kennung: "shot" },
      signal,
    );
    expect(attachments.read).toHaveBeenLastCalledWith(
      "ed",
      expect.objectContaining({ conversationId: "group" }),
      false,
    );
    const seeing = attachmentToolOf(
      { library: attachments },
      {
        agentId: "ed",
        conversationId: "group",
        assignment: { supportsImages: true },
      },
    );
    await seeing.readAttachments?.(
      "lesen",
      await workingFolder(),
      { kennung: "shot" },
      signal,
    );
    expect(attachments.read).toHaveBeenLastCalledWith(
      "ed",
      expect.anything(),
      true,
    );
  });

  it("registers both tools only for a job that reads attachments", async () => {
    interface RegisteredTool {
      readonly id: string;
      execute(
        parameters: Record<string, unknown>,
        context: { readonly signal: AbortSignal },
      ): Promise<unknown>;
    }
    const register = vi.fn<(tool: RegisteredTool) => void>();
    const registry = { register } as unknown as Parameters<
      typeof registerPicaEmployeeTools
    >[0];
    registerPicaEmployeeTools(
      registry,
      { authorize: () => Promise.resolve() },
      () => true,
    );
    expect(register).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "anhang_lesen" }),
    );
    const readAttachments = vi
      .fn()
      .mockResolvedValue({ ok: true, result: "{}", error: null });
    registerPicaEmployeeTools(
      registry,
      { authorize: () => Promise.resolve(), readAttachments },
      () => true,
    );
    const ids = register.mock.calls.map(([tool]) => tool.id);
    expect(ids).toEqual(
      expect.arrayContaining(["anhaenge_suchen", "anhang_lesen"]),
    );
    const reading = register.mock.calls.find(
      ([tool]) => tool.id === "anhang_lesen",
    )?.[0];
    expect(reading).toBeDefined();
    await reading?.execute({ kennung: "shot" }, { signal });
    expect(readAttachments).toHaveBeenCalledWith(
      "lesen",
      { kennung: "shot" },
      signal,
    );
  });
});
