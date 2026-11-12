import { expect, it, vi } from "vitest";

import { attemptPicaCloseoutStep } from "@/backend/service/chat/acp/PicaAcpCloseout";
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
