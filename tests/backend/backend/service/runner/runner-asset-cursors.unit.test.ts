import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { expect, it, vi } from "vitest";

import { RunnerAssetCursors } from "@/backend/service/runner/RunnerAssetCursors";

it("reads sequential chunks, replays the last chunk and reopens for an earlier offset", async () => {
  const bytes = Buffer.from("abcdef");
  const open = vi.fn(async () =>
    Readable.from([Buffer.from("abc"), Buffer.from("def")]),
  );
  const file = {
    size: bytes.length,
    digest: createHash("sha256").update(bytes).digest("hex"),
    open,
  };
  const cursors = new RunnerAssetCursors();
  await expect(cursors.read(0, 0, 2, file)).resolves.toEqual(Buffer.from("ab"));
  await expect(cursors.read(0, 0, 2, file)).resolves.toEqual(Buffer.from("ab"));
  await expect(cursors.read(0, 2, 4, file)).resolves.toEqual(
    Buffer.from("cdef"),
  );
  expect(open).toHaveBeenCalledTimes(1);
  await expect(cursors.read(0, 0, 2, file)).resolves.toEqual(Buffer.from("ab"));
  expect(open).toHaveBeenCalledTimes(2);
  cursors.close();
});

it("detects changed, truncated and oversized source streams", async () => {
  const cursors = new RunnerAssetCursors();
  const digest = createHash("sha256").update("abc").digest("hex");
  for (const content of ["abd", "ab", "abcd"]) {
    const file = {
      size: 3,
      digest,
      open: async () => Readable.from([Buffer.from(content)]),
    };
    await expect(cursors.read(0, 0, 3, file)).rejects.toMatchObject({
      code: "parameter_ticket_changed",
    });
  }
});
