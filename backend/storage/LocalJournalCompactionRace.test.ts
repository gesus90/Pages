import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type * as SessionFiles from "@/backend/agents/local/LocalSessionFiles";

const boundary = vi.hoisted(() => ({
  read: vi.fn<(file: string) => Promise<unknown>>(),
}));
vi.mock("@/backend/agents/local/LocalSessionFiles", async (importOriginal) => {
  const original = await importOriginal<typeof SessionFiles>();
  return { ...original, readLocalRecord: boundary.read };
});

import { LocalJournalCompaction } from "./LocalJournalCompaction";

it("handles acknowledged and retained records removed concurrently by another compactor", async () => {
  const base = pagesTempDirectory("journal-race-tests");
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, "case-"));
  const journal = path.join(
    directory,
    "local-sessions",
    "12345678-1234-1234-1234-123456789abc",
    "journal",
  );
  const actual = await vi.importActual<typeof SessionFiles>(
    "@/backend/agents/local/LocalSessionFiles",
  );
  const digest = "a".repeat(64);
  try {
    await mkdir(journal, { recursive: true });
    await writeFile(
      path.join(journal, "ack.json"),
      JSON.stringify({ sequence: 2, digest }),
      { mode: 0o600 },
    );
    for (let sequence = 1; sequence <= 4; sequence += 1) {
      const name = `${String(sequence).padStart(16, "0")}.json`;
      await writeFile(
        path.join(journal, name),
        JSON.stringify({
          sequence,
          previousDigest: "",
          digest,
          content: `entry-${sequence}`,
        }),
        { mode: 0o600 },
      );
    }
    const vanished = new Set([
      "0000000000000001.json",
      "0000000000000003.json",
    ]);
    boundary.read.mockImplementation(async (file) => {
      if (!vanished.has(path.basename(file)))
        return actual.readLocalRecord(file);
      await rm(file);
      throw Object.assign(new Error("concurrent deletion"), { code: "ENOENT" });
    });
    const query = vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]);
    const removePayload = vi
      .fn<(reference: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    await new LocalJournalCompaction(directory, removePayload).run({ query });
    expect((await readdir(journal)).sort()).toEqual([
      "0000000000000004.json",
      "ack.json",
    ]);
    expect(query).not.toHaveBeenCalled();
    expect(removePayload).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
