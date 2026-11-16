import { expect, it, vi } from "vitest";

import { GOOGLE_DRIVE_WRITE_SCOPES } from "@/backend/google/GoogleDriveConfig";
import { StorageBatchWriter } from "@/backend/service/google/StorageBatchWriter";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { Mock } from "vitest";

import type { StorageBatchRequest } from "@/backend/service/google/StorageBatchWriter";
import type {
  StorageConnection,
  StorageDriveClient,
} from "@/backend/service/google/StorageFileSupport";
import type { StorageFileWriter } from "@/backend/service/google/StorageFileWriter";
import type { StorageEntry } from "@/definition/GoogleDriveFiles";

const REQUEST: StorageBatchRequest = {
  action: "copy",
  sourceRef: "source",
  refs: ["one", "two"],
  targetParentRef: "target",
  userId: "user",
};

interface Fixture {
  service: StorageBatchWriter;
  access: Mock;
  stat: Mock;
  copy: Mock;
  move: Mock;
  trash: Mock;
  confirm: Mock;
  entries: Map<string, StorageEntry>;
}

function setup(): Fixture {
  const entries = new Map<string, StorageEntry>([
    ["source", partial<StorageEntry>({ ref: "source", isFolder: true })],
    [
      "one",
      partial<StorageEntry>({
        ref: "one",
        parentRef: "source",
        isFolder: false,
      }),
    ],
    [
      "two",
      partial<StorageEntry>({
        ref: "two",
        parentRef: "source",
        isFolder: true,
      }),
    ],
  ]);
  const access = vi.fn(async () => ({
    ok: true,
    accessToken: "token",
    grantedScopes: GOOGLE_DRIVE_WRITE_SCOPES,
  }));
  const stat = vi.fn(async (token: string, ref: string) => ({
    ok: token === "token",
    value: entries.get(ref),
  }));
  const copy = vi.fn(async () => ({ ok: true, value: {} }));
  const move = vi.fn(async () => ({ ok: true, value: {} }));
  const trash = vi.fn(async () => ({ ok: true, value: {} }));
  const confirm = vi.fn(async () => ({
    ok: true,
    value: { token: "confirm" },
  }));
  const service = new StorageBatchWriter(
    partial<StorageConnection>({ access }),
    partial<StorageDriveClient>({ stat }),
    partial<StorageFileWriter>({ copy, move, trash, confirm }),
  );
  return { service, access, stat, copy, move, trash, confirm, entries };
}

it("rejects malformed selections before accessing the provider", async () => {
  const { service, access } = setup();
  for (const request of [
    { ...REQUEST, action: "rename" },
    { ...REQUEST, refs: [] },
    { ...REQUEST, refs: ["one", "one"] },
    { ...REQUEST, refs: ["root"] },
    { ...REQUEST, targetParentRef: null },
    { ...REQUEST, sourceRef: "shared-drives" },
    { ...REQUEST, action: "delete", targetParentRef: "target" },
    {
      ...REQUEST,
      refs: Array.from({ length: 101 }, (_, index) => `item${index}`),
    },
  ]) {
    await expect(service.run(request)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
  }
  expect(access).not.toHaveBeenCalled();
});

it("copies files while reporting folders and entries outside the source", async () => {
  const { service, copy, entries } = setup();
  entries.set(
    "outside",
    partial<StorageEntry>({
      ref: "outside",
      parentRef: "other",
      isFolder: false,
    }),
  );
  await expect(
    service.run({ ...REQUEST, refs: ["one", "two", "outside"] }),
  ).resolves.toEqual({
    ok: true,
    value: {
      action: "copy",
      succeeded: 1,
      failures: [
        { ref: "two", code: "is_folder" },
        { ref: "outside", code: "invalid_reference" },
      ],
    },
  });
  expect(copy).toHaveBeenCalledWith({
    ref: "one",
    name: null,
    onConflict: "keep_both",
    targetParentRef: "target",
    userId: "user",
  });
});

it("moves entries and confirms a folder before trashing it", async () => {
  const { service, move, confirm, trash } = setup();
  await expect(
    service.run({ ...REQUEST, action: "move" }),
  ).resolves.toMatchObject({ ok: true, value: { succeeded: 2 } });
  expect(move).toHaveBeenCalledTimes(2);
  await expect(
    service.run({ ...REQUEST, action: "delete", targetParentRef: null }),
  ).resolves.toMatchObject({ ok: true, value: { succeeded: 2 } });
  expect(confirm).toHaveBeenCalledWith({
    action: "delete",
    ref: "two",
    userId: "user",
  });
  expect(trash).toHaveBeenNthCalledWith(1, {
    confirmation: null,
    ref: "one",
    userId: "user",
  });
  expect(trash).toHaveBeenNthCalledWith(2, {
    confirmation: "confirm",
    ref: "two",
    userId: "user",
  });
});
