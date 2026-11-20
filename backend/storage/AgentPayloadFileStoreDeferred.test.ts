import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import type { DatabaseTransaction } from "@/backend/database/Database";

vi.mock("./LocalJournalGarbage", () => ({
  LocalJournalGarbage: class {
    public schedule = vi.fn();
    public idle = vi.fn().mockResolvedValue(undefined);
    public close = vi.fn().mockResolvedValue(undefined);
  },
}));

import { AgentPayloadFileStore } from "./AgentPayloadFileStore";

it("removes journal payloads through the deferred collector", async () => {
  const root = pagesTempDirectory("deferred-payload-tests");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "case-"));
  const store = new AgentPayloadFileStore(directory);
  const id = "12345678-1234-1234-1234-123456789abc";
  const name = `local-sessions/${id}/`;
  const journal = path.join(directory, "local-sessions", id, "journal");
  const query = vi.fn<DatabaseTransaction["query"]>(
    async (statement, parameters) =>
      statement.includes("NOT LIKE") && parameters?.after === ""
        ? [[name]]
        : [],
  );
  const execute = vi
    .fn<DatabaseTransaction["execute"]>()
    .mockResolvedValue(undefined);
  const transaction = async <Result>(
    work: (access: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work({ query, execute });
  try {
    const reference = await store.write("plan", "content");
    await mkdir(journal, { recursive: true });
    await writeFile(
      path.join(journal, "0000000000000001.json"),
      JSON.stringify({ payload: reference }),
    );
    await store.collectGarbage({ query, execute, transaction });
    await store.settleGarbage();
    await expect(store.read(reference)).rejects.toMatchObject({
      code: "plan_payload_missing",
    });
    await expect(readdir(path.dirname(journal))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("DELETE FROM agent_payload_garbage"),
      { storage_name: name },
    );
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
