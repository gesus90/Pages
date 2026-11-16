import { beforeEach, expect, it, vi } from "vitest";

import { AgentAssetService } from "@/backend/service/agents/AgentAssetService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentAssetDependencies } from "@/backend/service/agents/AgentAssetService";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { UploadedFile } from "@/backend/service/WikiService";
import type { User } from "@/definition/User";

const insert = vi.fn();
const find = vi.fn();
const write = vi.fn();
const remove = vi.fn();
const open = vi.fn();
const settings = vi.fn();
const openAttachment = vi.fn();
const service = new AgentAssetService(
  partial<AgentAssetDependencies>({
    repository: { insert, find },
    files: { write, remove, open },
    wiki: { getSettings: settings, openAttachment },
  }),
);
const identity = partial<AgentIdentity>({
  userId: "user",
  isAdmin: false,
  permissions: ["write"],
  run: null,
});
const file = partial<UploadedFile>({
  fileName: "note.txt",
  contentLength: 5,
  body: {},
});

beforeEach(() => {
  vi.resetAllMocks();
  settings.mockResolvedValue({ mediaLimitBytes: 100, fileLimitBytes: 50 });
  write.mockResolvedValue({ storageName: "stored", size: 5 });
});

it("stages an upload only after revalidating the writer", async () => {
  const verify = vi.fn(async () => identity);
  const result = await service.upload(file, verify);
  expect(result).toMatchObject({ fileName: "note.txt", size: 5 });
  expect(verify).toHaveBeenCalledTimes(2);
  expect(insert).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: "user",
      status: "staged",
      storageName: "stored",
    }),
  );
});

it("rejects forbidden or oversized uploads before writing", async () => {
  await expect(
    service.upload(file, async () =>
      partial<AgentIdentity>({ ...identity, permissions: [] }),
    ),
  ).rejects.toThrow();
  await expect(
    service.upload({ ...file, contentLength: 101 }, async () => identity),
  ).rejects.toThrow();
  expect(write).not.toHaveBeenCalled();
});

it("discards staged bytes when revalidation changes identity or the file is empty", async () => {
  const verify = vi
    .fn()
    .mockResolvedValueOnce(identity)
    .mockResolvedValueOnce({ ...identity, userId: "other" });
  await expect(service.upload(file, verify)).rejects.toThrow();
  expect(remove).toHaveBeenCalledWith(["stored"]);
  write.mockResolvedValueOnce({ storageName: "empty", size: 0 });
  await expect(service.upload(file, async () => identity)).rejects.toThrow();
  expect(remove).toHaveBeenCalledWith(["empty"]);
  expect(insert).not.toHaveBeenCalled();
});

it("opens only owned, unexpired staging or a permitted linked attachment", async () => {
  const actor = partial<User>({ id: "user" });
  find.mockResolvedValue({
    userId: "user",
    status: "staged",
    expiresAt: Date.now() + 10000,
    fileName: "note.txt",
    contentType: "text/plain",
    size: 5,
    storageName: "stored",
  });
  open.mockReturnValue("stream");
  expect(await service.open(actor, "asset")).toMatchObject({
    fileName: "note.txt",
    stream: "stream",
  });
  find.mockResolvedValueOnce({
    userId: "other",
    status: "staged",
    expiresAt: Date.now() + 10000,
  });
  await expect(service.open(actor, "asset")).rejects.toThrow();
  find.mockResolvedValueOnce({ status: "linked", attachmentId: "attachment" });
  openAttachment.mockResolvedValue({
    attachment: { fileName: "linked.txt" },
    stream: "linked-stream",
  });
  expect(await service.open(actor, "asset")).toMatchObject({
    fileName: "linked.txt",
    stream: "linked-stream",
  });
});
