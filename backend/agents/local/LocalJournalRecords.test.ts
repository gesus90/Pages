import { createHash } from "node:crypto";

import { beforeEach, expect, it, vi } from "vitest";

import {
  localJournalDigest,
  readLocalJournalAcknowledgement,
} from "@/backend/agents/local/LocalJournalRecords";

const readLocalRecord = vi.hoisted(() => vi.fn());
vi.mock("@/backend/agents/local/LocalSessionFiles", () => ({
  readLocalRecord,
}));

const DIGEST = "a".repeat(64);

beforeEach(() => {
  readLocalRecord.mockReset();
});

function expectedDigest(body: string): string {
  return createHash("sha256")
    .update(JSON.stringify([3, "previous", body]))
    .digest("hex");
}

it("hashes a payload record over sequence, previous digest and payload", () => {
  expect(
    localJournalDigest({
      sequence: 3,
      previousDigest: "previous",
      payload: "p",
    }),
  ).toBe(expectedDigest("p"));
});

it("hashes a content record over sequence, previous digest and content", () => {
  expect(
    localJournalDigest({
      sequence: 3,
      previousDigest: "previous",
      content: "c",
    }),
  ).toBe(expectedDigest("c"));
});

it("reads the durable acknowledgement anchor", async () => {
  readLocalRecord.mockResolvedValue({ sequence: 4, digest: DIGEST });
  await expect(readLocalJournalAcknowledgement("/journal")).resolves.toEqual({
    sequence: 4,
    digest: DIGEST,
  });
  expect(readLocalRecord).toHaveBeenCalledWith("/journal/ack.json");
});

it("starts at zero when nothing was ever acknowledged", async () => {
  readLocalRecord.mockRejectedValue(
    Object.assign(new Error("missing"), { code: "ENOENT" }),
  );
  await expect(readLocalJournalAcknowledgement("/journal")).resolves.toEqual({
    sequence: 0,
    digest: "",
  });
});

it.each([
  new Error("broken"),
  Object.assign(new Error("denied"), { code: "EACCES" }),
  "not an error",
])("rethrows another failure", async (failure) => {
  readLocalRecord.mockRejectedValue(failure);
  await expect(readLocalJournalAcknowledgement("/journal")).rejects.toBe(
    failure,
  );
});

it("rejects a malformed anchor", async () => {
  readLocalRecord.mockResolvedValue({ sequence: -1, digest: "x" });
  await expect(readLocalJournalAcknowledgement("/journal")).rejects.toThrow();
});
