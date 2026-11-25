import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
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
    readFile: vi.fn(actual.readFile),
    readdir: vi.fn(actual.readdir),
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
const MANIFEST = "ticket-assets-manifest.json";

function uuid(index: number): string {
  return `00000000-0000-0000-0000-00000000000${index}`;
}

function contentOf(index: number): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(`payload ${index}`),
  ]);
}

function checksumOf(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

interface Env {
  readonly root: string;
  readonly data: string;
  readonly backup: string;
  attachments: Attachment[];
  readonly repository: {
    attachments: ReturnType<typeof vi.fn>;
    checkpoint: ReturnType<typeof vi.fn>;
    relocate: ReturnType<typeof vi.fn>;
  };
  readonly backupDatabase: Mock<(directory: string) => Promise<void>>;
  readonly service: TicketAssetMigrationService;
}

const roots: string[] = [];

async function createEnv(count: number): Promise<Env> {
  await mkdir(pagesTempDirectory("ticket-asset-migration-test"), {
    recursive: true,
  });
  const root = await mkdtemp(
    path.join(pagesTempDirectory("ticket-asset-migration-test"), "run-"),
  );
  roots.push(root);
  const dataDirectory = path.join(root, "data");
  await mkdir(path.join(dataDirectory, "ticket-attachments"), {
    recursive: true,
  });
  const attachments: Attachment[] = [];
  for (let index = 1; index <= count; index += 1) {
    const content = contentOf(index);
    await writeFile(
      path.join(dataDirectory, "ticket-attachments", uuid(index)),
      content,
    );
    attachments.push({
      checksum: checksumOf(content),
      id: uuid(index),
      size: content.length,
      storageName: uuid(index),
      workItemId: TICKET,
    });
  }
  const env: Env = {
    attachments,
    backup: path.join(root, "backup"),
    backupDatabase: vi.fn(async () => {}),
    data: dataDirectory,
    repository: {
      attachments: vi.fn(async () => env.attachments),
      checkpoint: vi.fn(async () => {}),
      relocate: vi.fn(
        async (entries: readonly { id: string; storageName: string }[]) => {
          env.attachments = env.attachments.map((attachment) => ({
            ...attachment,
            storageName:
              entries.find((entry) => entry.id === attachment.id)
                ?.storageName ?? attachment.storageName,
          }));
        },
      ),
    },
    root,
    service: undefined as never,
  };

  return {
    ...env,
    service: new TicketAssetMigrationService(
      doubleOf<TicketAssetMigrationRepository>(env.repository),
      dataDirectory,
      env.backup,
      env.backupDatabase,
    ),
  };
}

async function writeManifest(env: Env, content: unknown): Promise<void> {
  await mkdir(env.backup, { recursive: true });
  await writeFile(path.join(env.backup, MANIFEST), JSON.stringify(content));
}

beforeEach(() => {
  vi.mocked(copyFile).mockClear();
});

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { force: true, recursive: true });
});

describe("TicketAssetMigrationService construction", () => {
  it("refuses a backup inside or equal to the data directory", () => {
    const repository = doubleOf<TicketAssetMigrationRepository>({});
    const backup = vi.fn(async () => {});

    expect(
      () => new TicketAssetMigrationService(repository, "/d", "/d", backup),
    ).toThrow("outside");
    expect(
      () => new TicketAssetMigrationService(repository, "/d", "/d/b", backup),
    ).toThrow("outside");
    expect(
      () => new TicketAssetMigrationService(repository, "/d", "/dx", backup),
    ).not.toThrow();
  });
});

describe("TicketAssetMigrationService.inspect", () => {
  it("plans the moves without writing anything", async () => {
    const env = await createEnv(2);

    const entries = await env.service.inspect();

    expect(entries).toEqual([
      expect.objectContaining({
        contentType: "image/png",
        kind: "media",
        oldStorageName: uuid(1),
        storageName: `assets/${TICKET}/${uuid(1)}.png`,
      }),
      expect.objectContaining({ id: uuid(2) }),
    ]);
    expect(existsSync(env.backup)).toBe(false);
    expect(env.repository.relocate).not.toHaveBeenCalled();
  });

  it("accepts a store that was already migrated", async () => {
    const env = await createEnv(1);
    await env.service.migrate();

    await expect(env.service.inspect()).resolves.toHaveLength(1);
  });

  it("rejects a size or checksum mismatch", async () => {
    const env = await createEnv(1);
    env.attachments[0].checksum = "0".repeat(64);

    await expect(env.service.inspect()).rejects.toThrow("mismatch");
    env.attachments[0].checksum = checksumOf(contentOf(1));
    env.attachments[0].size += 1;
    await expect(env.service.inspect()).rejects.toThrow("mismatch");
  });

  it("rejects an invalid ticket identifier", async () => {
    const env = await createEnv(1);
    env.attachments[0].workItemId = "not-a-uuid";

    await expect(env.service.inspect()).rejects.toThrow("invalid identifier");
  });

  it("rejects a new-style path that is not the expected destination", async () => {
    const env = await createEnv(1);
    const wrong = `assets/${TICKET}/${uuid(1)}.jpg`;
    await mkdir(path.join(env.data, "assets", TICKET), { recursive: true });
    await writeFile(path.join(env.data, wrong), contentOf(1));
    env.attachments[0].storageName = wrong;

    await expect(env.service.inspect()).rejects.toThrow(
      "unexpected destination",
    );
  });
});

describe("TicketAssetMigrationService stores", () => {
  it("reports files without records in the legacy store", async () => {
    const env = await createEnv(1);
    await writeFile(path.join(env.data, "ticket-attachments", "stray"), "x");
    await mkdir(path.join(env.data, "ticket-attachments", "folder"));

    await expect(env.service.inspect()).rejects.toThrow("folder, stray");
  });

  it("tolerates a missing legacy store and rethrows other read errors", async () => {
    const env = await createEnv(0);
    await rm(path.join(env.data, "ticket-attachments"), { recursive: true });

    await expect(env.service.inspect()).resolves.toEqual([]);
    vi.mocked(readdir).mockRejectedValueOnce("broken");
    await expect(env.service.inspect()).rejects.toBe("broken");
    vi.mocked(readdir).mockRejectedValueOnce(new Error("no code"));
    await expect(env.service.inspect()).rejects.toThrow("no code");
  });

  it("reports unknown entries in the asset store", async () => {
    const env = await createEnv(1);
    const folder = path.join(env.data, "assets", TICKET);
    await mkdir(path.join(folder, "nested"), { recursive: true });
    await writeFile(path.join(folder, "unknown.png"), "x");
    await writeFile(path.join(env.data, "assets", "loose"), "x");

    await expect(env.service.inspect()).rejects.toThrow(
      `assets/${TICKET}/nested, assets/${TICKET}/unknown.png, assets/loose`,
    );
  });

  it("rethrows an unreadable asset store", async () => {
    const env = await createEnv(0);
    vi.mocked(readdir).mockResolvedValueOnce([]);
    vi.mocked(readdir).mockRejectedValueOnce(new Error("denied"));

    await expect(env.service.inspect()).rejects.toThrow("denied");
  });
});

function validEntry(overrides: Record<string, unknown> = {}): object {
  return {
    checksum: "a".repeat(64),
    contentType: "image/png",
    id: uuid(1),
    kind: "media",
    oldStorageName: uuid(1),
    size: 1,
    storageName: `assets/${TICKET}/${uuid(1)}.png`,
    ...overrides,
  };
}

describe("TicketAssetMigrationService manifest validation", () => {
  const invalidManifests: readonly [string, (env: Env) => unknown][] = [
    ["a non-object", () => 5],
    ["null", () => null],
    ["a missing directory", () => ({ entries: [] })],
    ["a non-string directory", () => ({ directory: 1, entries: [] })],
    ["missing entries", (env) => ({ directory: env.data })],
    ["non-array entries", (env) => ({ directory: env.data, entries: 1 })],
    ["another directory", () => ({ directory: "/elsewhere", entries: [] })],
    ["a non-object entry", (env) => ({ directory: env.data, entries: [1] })],
    ["a null entry", (env) => ({ directory: env.data, entries: [null] })],
    ...[
      ["id", { id: 1 }],
      ["a missing id", { id: undefined }],
      ["a non-string storage name", { storageName: 1 }],
      ["a missing storage name", { storageName: undefined }],
      ["a legacy storage name", { storageName: uuid(1) }],
      ["a non-string old name", { oldStorageName: 1 }],
      ["a missing old name", { oldStorageName: undefined }],
      ["a foreign old name", { oldStorageName: "../x" }],
      ["a non-string checksum", { checksum: 1 }],
      ["a missing checksum", { checksum: undefined }],
      ["a short checksum", { checksum: "ab" }],
      ["a non-string content type", { contentType: 1 }],
      ["a missing content type", { contentType: undefined }],
      ["an unknown kind", { kind: "other" }],
      ["a missing kind", { kind: undefined }],
      ["a non-number size", { size: "1" }],
      ["a missing size", { size: undefined }],
      ["a fractional size", { size: 1.5 }],
      ["a negative size", { size: -1 }],
    ].map(([name, overrides]): [string, (env: Env) => unknown] => [
      `an entry with ${String(name)}`,
      (env) => ({
        directory: env.data,
        entries: [validEntry(overrides as Record<string, unknown>)],
      }),
    ]),
  ];

  it.each(invalidManifests)("rejects %s", async (...row) => {
    const env = await createEnv(0);
    await writeManifest(env, row[1](env));

    await expect(env.service.inspect()).rejects.toThrow("Invalid migration");
  });

  it("rejects unreadable manifests", async () => {
    const env = await createEnv(0);
    await mkdir(path.join(env.backup, MANIFEST), { recursive: true });

    await expect(env.service.inspect()).rejects.toThrow("EISDIR");
    vi.mocked(readFile).mockRejectedValueOnce("odd");
    await expect(env.service.inspect()).rejects.toBe("odd");
    vi.mocked(readFile).mockRejectedValueOnce(new Error("plain"));
    await expect(env.service.inspect()).rejects.toThrow("plain");
  });

  it("rejects text that is not JSON", async () => {
    const env = await createEnv(0);
    await mkdir(env.backup);
    await writeFile(path.join(env.backup, MANIFEST), "{");

    await expect(env.service.inspect()).rejects.toThrow(SyntaxError);
  });

  it("accepts a valid manifest of the same data directory", async () => {
    const env = await createEnv(0);
    await writeManifest(env, { directory: env.data, entries: [] });

    await expect(env.service.inspect()).resolves.toEqual([]);
  });
});

describe("TicketAssetMigrationService manifest comparison", () => {
  it("rejects a changed attachment count", async () => {
    const env = await createEnv(1);
    await writeManifest(env, { directory: env.data, entries: [] });

    await expect(env.service.inspect()).rejects.toThrow("count changed");
  });

  it("rejects entries that differ from the manifest", async () => {
    const env = await createEnv(1);
    const [planned] = await env.service.inspect();
    const variants = [
      { id: uuid(9) },
      { storageName: `assets/${TICKET}/${uuid(1)}.jpg` },
      { checksum: "b".repeat(64) },
      { size: planned.size + 1 },
    ];

    for (const variant of variants) {
      await writeManifest(env, {
        directory: env.data,
        entries: [{ ...planned, ...variant }],
      });
      await expect(env.service.inspect()).rejects.toThrow(
        "differs from backup",
      );
    }
  });
});
