import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  appendFile,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import { TicketAssetMigrationService } from "./TicketAssetMigrationService";

import type * as FileSystem from "node:fs/promises";
import type { Mock } from "vitest";
import type { TicketAssetMigrationRepository } from "@/backend/database/repositories/task/TicketAssetMigrationRepository";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof FileSystem>();

  return {
    ...actual,
    copyFile: vi.fn(actual.copyFile),
    lstat: vi.fn(actual.lstat),
  };
});

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

interface Attachment {
  id: string;
  workItemId: string;
  storageName: string;
  checksum: string;
  size: number;
}

const TICKET = "10000000-0000-0000-0000-000000000001";
const ID = "00000000-0000-0000-0000-000000000001";
const MANIFEST = "ticket-assets-manifest.json";
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("payload"),
]);
const NEW_NAME = `assets/${TICKET}/${ID}.png`;

interface Repository {
  attachments: Mock<() => Promise<Attachment[]>>;
  checkpoint: Mock<() => Promise<void>>;
  relocate: Mock<
    (entries: readonly { id: string; storageName: string }[]) => Promise<void>
  >;
}

interface Env {
  readonly data: string;
  readonly backup: string;
  attachments: Attachment[];
  readonly repository: Repository;
  readonly backupDatabase: Mock<(directory: string) => Promise<void>>;
  readonly service: TicketAssetMigrationService;
}

const roots: string[] = [];

async function createEnv(): Promise<Env> {
  const parent = pagesTempDirectory("ticket-asset-migration-test");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "run-"));
  roots.push(root);
  const dataDirectory = path.join(root, "data");
  await mkdir(path.join(dataDirectory, "ticket-attachments"), {
    recursive: true,
  });
  await writeFile(path.join(dataDirectory, "ticket-attachments", ID), PNG);
  const repository: Repository = {
    attachments: vi.fn(async () => env.attachments),
    checkpoint: vi.fn(async () => {}),
    relocate: vi.fn(async (entries) => {
      env.attachments = env.attachments.map((attachment) => ({
        ...attachment,
        storageName:
          entries.find((entry) => entry.id === attachment.id)?.storageName ??
          attachment.storageName,
      }));
    }),
  };
  const env = {
    attachments: [
      {
        checksum: createHash("sha256").update(PNG).digest("hex"),
        id: ID,
        size: PNG.length,
        storageName: ID,
        workItemId: TICKET,
      },
    ],
    backup: path.join(root, "backup"),
    backupDatabase: vi.fn(async () => {}),
    data: dataDirectory,
    repository,
  };
  return Object.assign(env, {
    service: new TicketAssetMigrationService(
      doubleOf<TicketAssetMigrationRepository>(env.repository),
      dataDirectory,
      env.backup,
      env.backupDatabase,
    ),
  });
}

async function editManifest(
  env: Env,
  change: (entry: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const file = path.join(env.backup, MANIFEST);
  const manifest = JSON.parse(await readFile(file, "utf8")) as {
    entries: Record<string, unknown>[];
  };
  await writeFile(
    file,
    JSON.stringify({ ...manifest, entries: manifest.entries.map(change) }),
  );
}

beforeEach(() => {
  vi.mocked(copyFile).mockClear();
});

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { force: true, recursive: true });
});

describe("TicketAssetMigrationService.migrate", () => {
  it("backs up, moves, verifies and removes the original", async () => {
    const env = await createEnv();

    const result = await env.service.migrate();

    expect(result).toMatchObject({
      attachmentCount: 1,
      backupDirectory: env.backup,
      movedCount: 1,
    });
    expect(env.repository.checkpoint).toHaveBeenCalled();
    expect(env.backupDatabase).toHaveBeenCalledWith(env.backup);
    expect(existsSync(path.join(env.backup, MANIFEST))).toBe(true);
    expect(
      existsSync(path.join(env.backup, "data", "ticket-attachments", ID)),
    ).toBe(true);
    expect(existsSync(path.join(env.data, NEW_NAME))).toBe(true);
    expect(existsSync(path.join(env.data, "ticket-attachments", ID))).toBe(
      false,
    );
  });

  it("reports nothing to move on a repeat with the same backup", async () => {
    const env = await createEnv();
    await env.service.migrate();

    await expect(env.service.migrate()).resolves.toMatchObject({
      backupDirectory: env.backup,
      movedCount: 0,
    });
  });

  it("reports no backup when nothing was ever moved", async () => {
    const env = await createEnv();
    await env.service.migrate();
    await rm(env.backup, { force: true, recursive: true });

    await expect(env.service.migrate()).resolves.toMatchObject({
      backupDirectory: null,
      movedCount: 0,
    });
  });

  it("resumes after an interruption and reuses copied destinations", async () => {
    const env = await createEnv();
    env.repository.relocate.mockRejectedValueOnce(new Error("interrupted"));

    await expect(env.service.migrate()).rejects.toThrow("interrupted");
    await expect(env.service.migrate()).resolves.toMatchObject({
      movedCount: 1,
    });
    expect(env.backupDatabase).toHaveBeenCalledTimes(1);
  });

  it("refuses a backup that no longer matches the data", async () => {
    const env = await createEnv();
    env.backupDatabase.mockImplementation(async () => {
      await appendFile(path.join(env.data, "ticket-attachments", ID), "!");
    });

    await expect(env.service.migrate()).rejects.toThrow(
      "Backup verification failed",
    );
  });

  it("refuses a destination that differs from the original", async () => {
    const env = await createEnv();
    await mkdir(path.join(env.data, "assets", TICKET), { recursive: true });
    await writeFile(path.join(env.data, NEW_NAME), "different");

    await expect(env.service.migrate()).rejects.toThrow("Destination mismatch");
    expect(existsSync(path.join(env.data, "ticket-attachments", ID))).toBe(
      true,
    );
  });

  it("rethrows copy failures other than an existing destination", async () => {
    const failures = [
      "text",
      new Error("no code"),
      Object.assign(new Error("x"), { code: "EACCES" }),
    ];

    for (const failure of failures) {
      const env = await createEnv();
      vi.mocked(copyFile).mockImplementation(async (source, target, mode) => {
        if (String(target).startsWith(env.data)) throw failure;

        return vi
          .importActual<typeof FileSystem>("node:fs/promises")
          .then((actual) => actual.copyFile(source, target, mode));
      });

      await expect(env.service.migrate()).rejects.toBe(failure);
      vi.mocked(copyFile).mockReset();
    }
  });
});

describe("TicketAssetMigrationService.migrate metadata checks", () => {
  const relocations: readonly [string, (env: Env) => void, string][] = [
    ["a changed count", (env) => (env.attachments = []), "count changed"],
    [
      "an unknown attachment",
      (env) => (env.attachments = [{ ...env.attachments[0], id: "other" }]),
      "Metadata mismatch",
    ],
    [
      "another storage name",
      (env) => (env.attachments = [{ ...env.attachments[0], storageName: ID }]),
      "Metadata mismatch",
    ],
    [
      "another checksum",
      (env) =>
        (env.attachments = [
          { ...env.attachments[0], checksum: "c", storageName: NEW_NAME },
        ]),
      "Metadata mismatch",
    ],
    [
      "another size",
      (env) =>
        (env.attachments = [
          { ...env.attachments[0], size: 1, storageName: NEW_NAME },
        ]),
      "Metadata mismatch",
    ],
  ];

  it.each(relocations)("retains originals after %s", async (...row) => {
    const env = await createEnv();
    env.repository.relocate.mockImplementation(async () => row[1](env));

    await expect(env.service.migrate()).rejects.toThrow(row[2]);
    expect(existsSync(path.join(env.data, "ticket-attachments", ID))).toBe(
      true,
    );
  });
});

describe("TicketAssetMigrationService.migrate leftover originals", () => {
  const oldFile = (env: Env): string =>
    path.join(env.data, "ticket-attachments", ID);

  it("removes a leftover original that still matches", async () => {
    const env = await createEnv();
    await env.service.migrate();
    await writeFile(oldFile(env), PNG);

    await env.service.migrate();

    expect(existsSync(oldFile(env))).toBe(false);
  });

  it("keeps a leftover original that changed and reports it", async () => {
    const env = await createEnv();
    await env.service.migrate();
    await writeFile(oldFile(env), "changed");

    await expect(env.service.migrate()).rejects.toThrow("Original changed");
    expect(existsSync(oldFile(env))).toBe(true);
  });

  const unrelated: readonly [string, Record<string, unknown>][] = [
    [
      "an attachment that is gone",
      { id: "20000000-0000-0000-0000-000000000002" },
    ],
    ["another checksum", { checksum: "c".repeat(64) }],
    ["another destination", { storageName: `assets/${TICKET}/${ID}.jpg` }],
  ];

  it.each(unrelated)("skips a manifest entry for %s", async (...row) => {
    const env = await createEnv();
    await env.service.migrate();
    await writeFile(oldFile(env), PNG);
    await editManifest(env, (entry) => ({ ...entry, ...row[1] }));

    await env.service.migrate();

    expect(existsSync(oldFile(env))).toBe(true);
  });

  it("skips a manifest entry that was never moved", async () => {
    const env = await createEnv();
    await env.service.migrate();
    await editManifest(env, (entry) => ({
      ...entry,
      oldStorageName: NEW_NAME,
    }));

    await expect(env.service.migrate()).resolves.toMatchObject({
      movedCount: 0,
    });
  });

  it("rethrows other failures when looking for the original", async () => {
    const env = await createEnv();
    await env.service.migrate();
    const actual = await vi.importActual<typeof FileSystem>("node:fs/promises");
    vi.mocked(lstat)
      .mockImplementationOnce(actual.lstat)
      .mockImplementationOnce(actual.lstat)
      .mockRejectedValueOnce(new Error("denied"));

    await expect(env.service.migrate()).rejects.toThrow("denied");
  });
});
