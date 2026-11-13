import { Readable } from "node:stream";

import { expect, it, vi } from "vitest";

import { PicaAcpSelections } from "@/backend/service/chat/acp/PicaAcpSelections";
import { conversationTurnPreparation } from "@/backend/service/employee/AgentConversationContent";

import { OWNER } from "../chat/page48-chat-fixture";

import type { ConversationAgentRequest } from "@/backend/service/conversation/ConversationAgentReplies";
import type { ConversationAttachment } from "@/definition/ConversationContent";

function request(
  files: readonly ConversationAttachment[],
): ConversationAgentRequest {
  return {
    agent: { ...OWNER, isAgent: true },
    person: OWNER,
    conversation: { id: "group", name: "Team", kind: "group" },
    prompt: "Read this",
    lastMessage: "Read this",
    attachments: files,
    prepareTurn: async () => ({
      prompt: "Read this with files",
      attachments: files,
      throughSequence: 31,
    }),
    openAttachment: vi.fn(async () =>
      Readable.from([Buffer.from("file contents")]),
    ),
  };
}

const image: ConversationAttachment = {
  id: "image",
  name: "screenshot.png",
  mimeType: "image/png",
  sizeBytes: 13,
  kind: "image",
  url: "/chat/files/image",
};

it("PAGE-344 sends image bytes as an ACP image and text files as resources through the selected reader", async () => {
  const input = request([
    image,
    {
      ...image,
      id: "text",
      name: "notes.txt",
      mimeType: "text/plain",
      kind: "file",
    },
  ]);
  const prepare = conversationTurnPreparation(input);
  if (!prepare) throw new Error("Missing preparation");
  const turn = await prepare(1);
  const fallback = { readText: vi.fn(), readBytes: vi.fn() };
  const selections = new PicaAcpSelections(fallback, vi.fn());
  const content = await selections.read(
    { ...turn, id: "message" },
    { image: true, embeddedContext: true },
  );
  expect(content.blocks).toContainEqual({
    type: "image",
    mimeType: "image/png",
    data: Buffer.from("file contents").toString("base64"),
  });
  expect(content.blocks).toContainEqual({
    type: "resource",
    resource: {
      uri: "pages-chat://attachment/text",
      mimeType: "text/plain",
      text: "file contents",
    },
  });
  expect(content.items.map((item) => item.transfer)).toEqual(["full", "full"]);
  expect(input.openAttachment).toHaveBeenCalledWith("image");
  expect(input.openAttachment).toHaveBeenCalledWith("text");
  expect(fallback.readBytes).not.toHaveBeenCalled();
  expect(fallback.readText).not.toHaveBeenCalled();
});

it("PAGE-344 explicitly reports unsupported images and unreadable files", async () => {
  const input = request([image]);
  const prepare = conversationTurnPreparation(input);
  if (!prepare) throw new Error("Missing preparation");
  const turn = await prepare(null);
  const reader = { readText: vi.fn(), readBytes: vi.fn() };
  const unsupported = await new PicaAcpSelections(reader, vi.fn()).read(
    { ...turn, id: "no-vision" },
    { image: false },
  );
  expect(unsupported.items).toEqual([
    expect.objectContaining({ transfer: "unsupported" }),
  ]);
  expect(input.openAttachment).not.toHaveBeenCalled();
  const denied = {
    ...request([image]),
    openAttachment: vi.fn(async () => {
      throw new Error("membership withdrawn");
    }),
  };
  const deniedPrepare = conversationTurnPreparation(denied);
  if (!deniedPrepare) throw new Error("Missing preparation");
  const deniedTurn = await deniedPrepare(null);
  const unreadable = await new PicaAcpSelections(reader, vi.fn()).read(
    { ...deniedTurn, id: "denied" },
    { image: true },
  );
  expect(unreadable.items).toEqual([
    expect.objectContaining({ transfer: "unreadable" }),
  ]);
});

it("PAGE-344 bounds file reads and refuses an attachment outside the selected turn", async () => {
  const prepare = conversationTurnPreparation(request([image]));
  if (!prepare) throw new Error("Missing preparation");
  const turn = await prepare(null);
  const file = turn.attachments[0];
  if (!file || !turn.attachmentReader) throw new Error("Missing attachment");
  await expect(turn.attachmentReader.readBytes(file, 2)).resolves.toBeNull();
  await expect(turn.attachmentReader.readText(file, 4)).resolves.toBe("file");
  await expect(
    turn.attachmentReader.readBytes({ ...file, id: "other" }, 20),
  ).rejects.toThrow("outside this turn");
});
