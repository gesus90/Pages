import { expect, it, vi } from "vitest";

import { attemptPicaCloseoutStep } from "@/backend/service/chat/acp/PicaAcpCloseout";
import { PicaAcpPrompt } from "@/backend/service/chat/acp/PicaAcpPrompt";
import { PicaAcpSelections } from "@/backend/service/chat/acp/PicaAcpSelections";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
}));

import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

it("caches each message payload and records a successful selection only once", async () => {
  const reader = { readText: vi.fn(), readBytes: vi.fn() };
  const record = vi.fn(async () => undefined);
  const selections = new PicaAcpSelections(reader, record);
  const message = { id: "message", text: "Hello", attachments: [] };
  const first = selections.read(message, null);
  expect(selections.read(message, { embeddedContext: true })).toBe(first);
  await expect(first).resolves.toEqual({ blocks: [], items: [] });
  await selections.select(message.id, []);
  await selections.select(message.id, []);
  expect(record).toHaveBeenCalledOnce();
  expect(record).toHaveBeenCalledWith({ messageId: "message", items: [] });
});

it("allows a failed selection write to be retried", async () => {
  const record = vi
    .fn()
    .mockRejectedValueOnce(new Error("write failed"))
    .mockResolvedValue(undefined);
  const selections = new PicaAcpSelections(
    { readText: vi.fn(), readBytes: vi.fn() },
    record,
  );
  await expect(selections.select("message", [])).rejects.toThrow(
    "write failed",
  );
  await selections.select("message", []);
  expect(record).toHaveBeenCalledTimes(2);
});

it("logs a closeout failure without rejecting, and leaves successful steps unlogged", async () => {
  vi.clearAllMocks();
  const error = new Error("synthetic failure");
  await attemptPicaCloseoutStep(async () => {
    throw error;
  });
  expect(logCaughtError).toHaveBeenCalledWith("PicaAcpJob", error);
  expect(logDiagnostic).toHaveBeenCalledWith(
    "PicaAcpJob",
    "error",
    "[pages] A Pica job closeout step failed.",
    error,
  );
  await attemptPicaCloseoutStep(async () => undefined);
  expect(logCaughtError).toHaveBeenCalledOnce();
});

it("PAGE-344 constructs and records the negotiated prompt payload and reuses it for steering", async () => {
  const reader = { readText: vi.fn(async () => "notes"), readBytes: vi.fn() };
  const record = vi.fn(async () => undefined);
  const selections = new PicaAcpSelections(reader, record);
  const prompt = new PicaAcpPrompt(selections, () => "Turn-bound tools");
  const message = {
    id: "message",
    text: "Read",
    attachments: [
      {
        id: "file",
        sessionId: "chat",
        messageId: "message",
        fileName: "notes.txt",
        contentType: "text/plain",
        storageName: "file",
        size: 5,
      },
    ],
  };
  const input = prompt.create(message, {
    instructions: "Instructions",
    prompt: {
      personName: "Person",
      interfaceLanguage: "de",
      today: "today",
      history: [],
    },
  });
  expect(input.prompt).toContain("notes.txt");
  expect(input.prompt).toContain("Turn-bound tools");
  prompt.negotiated({ embeddedContext: true });
  if (!input.promptContent) throw new Error("Missing prompt content");
  const blocks = await input.promptContent({ embeddedContext: true });
  expect(blocks).toContainEqual({
    type: "resource",
    resource: {
      uri: "pages-chat://attachment/file",
      mimeType: "text/plain",
      text: "notes",
    },
  });
  await input.promptContent({ embeddedContext: true });
  expect(record).toHaveBeenCalledOnce();
  expect(reader.readText).toHaveBeenCalledOnce();
  await expect(prompt.read(message)).resolves.toMatchObject({ blocks });
});

it("PAGE-344 names an image as unsupported when the selected model cannot read it", async () => {
  const reader = { readText: vi.fn(), readBytes: vi.fn() };
  const prompt = new PicaAcpPrompt(
    new PicaAcpSelections(reader, vi.fn()),
    () => "Tools",
    false,
  );
  prompt.negotiated({ image: true });
  const content = await prompt.read({
    id: "message",
    text: "Look",
    attachments: [
      {
        id: "image",
        sessionId: "chat",
        messageId: "message",
        fileName: "image.png",
        contentType: "image/png",
        storageName: "image",
        size: 3,
      },
    ],
  });
  expect(content.items).toEqual([
    expect.objectContaining({ transfer: "unsupported" }),
  ]);
  expect(reader.readBytes).not.toHaveBeenCalled();
});
