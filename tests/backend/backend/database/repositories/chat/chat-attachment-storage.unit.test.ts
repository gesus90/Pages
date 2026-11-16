import { describe, expect, it, vi } from "vitest";

import { ChatAttachmentRepository } from "@/backend/database/repositories/chat/ChatAttachmentRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

const row = [
  "a",
  "s",
  null,
  "file.txt",
  "text/plain",
  4,
  "stored",
  "user",
  null,
];
const attachment = {
  sessionId: "s",
  fileName: "file.txt",
  contentType: "text/plain",
  size: 4,
  storageName: "stored",
};

function fixture(): {
  repository: ChatAttachmentRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  const execute = vi.fn().mockResolvedValue(undefined);
  const transaction = partial<DatabaseTransaction>({ query, execute });
  return {
    repository: new ChatAttachmentRepository(
      partial<Database>({
        query,
        execute,
        transaction: async <Result>(
          work: (activeTransaction: DatabaseTransaction) => Promise<Result>,
        ): Promise<Result> => work(transaction),
      }),
    ),
    query,
    execute,
  };
}

describe("chat attachment storage", () => {
  it("distinguishes stored, full and missing sessions", async () => {
    const { repository, query } = fixture();
    query
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([["s"]])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await expect(
      repository.insertUpload("u", attachment, 1),
    ).resolves.toMatchObject({ kind: "stored", attachment: { id: "a" } });
    await expect(repository.insertUpload("u", attachment, 1)).resolves.toEqual({
      kind: "full",
    });
    await expect(repository.insertUpload("u", attachment, 1)).resolves.toEqual({
      kind: "sessionMissing",
    });
  });

  it("reads assistant files and orders claimed and removed files", async () => {
    const { repository, query } = fixture();
    const assistant = [...row.slice(0, 7), "assistant", "run"];
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([assistant])
      .mockResolvedValueOnce([
        [...assistant, 2],
        [...assistant.slice(0, 3), "a.txt", ...assistant.slice(4), 1],
      ])
      .mockResolvedValueOnce([
        ["second", 2],
        ["first", 1],
      ]);
    await expect(
      repository.insertAnswerFile("u", { ...attachment, runId: "run" }),
    ).resolves.toBeNull();
    await expect(repository.answerFiles("s", "run")).resolves.toMatchObject([
      { origin: "assistant", runId: "run" },
    ]);
    expect(
      (await repository.claimAnswerFiles("s", "run", "m")).map(
        (entry) => entry.fileName,
      ),
    ).toEqual(["a.txt", "file.txt"]);
    await expect(
      repository.removeUnclaimedAnswerFiles(null, null),
    ).resolves.toEqual(["first", "second"]);
  });

  it("removes only a locked unclaimed file", async () => {
    const { repository, query, execute } = fixture();
    const remove = vi.fn().mockResolvedValue(undefined);
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([["stored"]]);
    await repository.removeUnclaimedAnswerFile("s", "run", "missing", remove);
    await repository.removeUnclaimedAnswerFile("s", "run", "a", remove);
    expect(remove).toHaveBeenCalledExactlyOnceWith("stored");
    expect(execute).toHaveBeenCalledOnce();
  });
});
