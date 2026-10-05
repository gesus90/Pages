import { existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  link,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();

  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();

  return {
    ...actual,
    copyFile: vi.fn(actual.copyFile),
    link: vi.fn(actual.link),
  };
});

import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { ConfigFile } from "@/backend/config/ConfigFile";
import { Database } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { InstanceSettingsRepository } from "@/backend/database/repositories/InstanceSettingsRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { PagesRuntime } from "@/backend/runtime/PagesRuntime";
import { SetupWizardService } from "@/backend/setup/SetupWizardService";
import { ROLE } from "@/definition/Role";

import { createPagesDatabaseFile } from "../helpers/pages-database-file";

import type {
  ServiceActivation,
  SetupInput,
} from "@/backend/setup/SetupWizardService";

const INPUT: Omit<SetupInput, "databasePath"> = {
  companyName: "Pages GmbH",
  email: null,
  language: "de",
  password: "geheimes-passwort",
  userAgent: null,
  username: "chef",
};

/** Hashing with scrypt is slow, so the tests use a cheap stand-in. */
function createHasher(): PasswordHasher {
  return {
    hash: vi.fn(async (password: string) => `hashed:${password}`),
  } as unknown as PasswordHasher;
}

async function readDatabase<Result>(
  databasePath: string,
  read: (database: Database) => Promise<Result>,
): Promise<Result> {
  const database = await Database.create(databasePath);

  try {
    return await read(database);
  } finally {
    await database.close();
  }
}

describe("SetupWizardService", () => {
  let directory: string;
  let databasePath: string;
  let runtime: PagesRuntime;
  let token: string;
  let activated: Database[];
  let activateServices: ServiceActivation & ReturnType<typeof vi.fn>;

  function createService(
    overrides: Partial<
      ConstructorParameters<typeof SetupWizardService>[0]
    > = {},
  ): SetupWizardService {
    return new SetupWizardService({
      activateServices,
      passwordHasher: createHasher(),
      runtime,
      ...overrides,
    });
  }

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "pages-wizard-"));
    databasePath = path.join(directory, "pages.duckdb");

    const configFile = new ConfigFile(path.join(directory, "config.toml"));

    await configFile.write({ databasePath: null, firstRun: true, port: 4100 });
    runtime = new PagesRuntime(configFile, {
      databasePath: null,
      firstRun: true,
      port: 4100,
    });
    token = runtime.getSetupToken() ?? "";
    activated = [];
    activateServices = vi.fn(async (database: Database) => {
      activated.push(database);
    }) as typeof activateServices;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    await Promise.all(activated.map((database) => database.close()));
    vi.restoreAllMocks();
    await chmod(directory, 0o700);
    await rm(directory, { force: true, recursive: true });
  });

  it("creates the database, stores the configuration, and signs in", async () => {
    const result = await createService().complete(
      { ...INPUT, databasePath },
      token,
    );

    expect(result).toEqual({
      sessionToken: expect.any(String),
      status: "completed",
    });
    expect(runtime.isSetupPending()).toBe(false);
    expect(runtime.verifySetupToken(token)).toBe(false);
    await expect(runtime.configFile.read()).resolves.toEqual({
      databasePath,
      firstRun: false,
      port: 4100,
    });
    expect(activateServices).toHaveBeenCalledWith(
      expect.any(Database),
      databasePath,
    );
    // An open database keeps a write-ahead log next to it; no staging file remains.
    expect(
      (await readdir(directory))
        .filter((name) => !name.endsWith(".wal"))
        .sort(),
    ).toEqual(["config.toml", "pages.duckdb"]);

    const credentials = await new UserRepository(
      activated[0] as Database,
    ).findCredentialsByUsername("chef");

    expect(credentials).toMatchObject({
      passwordHash: "hashed:geheimes-passwort",
      user: { role: ROLE.ADMIN },
    });
  });

  it("opens an existing Pages database and keeps its data", async () => {
    await createPagesDatabaseFile(databasePath, {
      users: [
        { id: "admin-1", username: "chef" },
        { id: "team-1", role: ROLE.EMPLOYEE, username: "team" },
      ],
    });

    const result = await createService().complete(
      { ...INPUT, companyName: "Neu AG", databasePath },
      token,
    );

    expect(result.status).toBe("completed");

    const database = activated[0] as Database;

    await expect(new UserRepository(database).findAll()).resolves.toHaveLength(
      2,
    );
    await expect(
      new InstanceSettingsRepository(database).find(),
    ).resolves.toEqual({
      companyName: "Neu AG",
      primaryAdministratorId: "admin-1",
    });
  });

  it("refuses requests once the setup finished or without the token", async () => {
    const service = createService();

    await expect(
      service.complete({ ...INPUT, databasePath }, "guess"),
    ).resolves.toEqual({ status: "invalidToken" });

    runtime.finishSetup({ databasePath, firstRun: false, port: 4100 });

    await expect(
      service.complete({ ...INPUT, databasePath }, token),
    ).resolves.toEqual({
      status: "alreadyCompleted",
    });
    expect(existsSync(databasePath)).toBe(false);
  });

  it("lets exactly one of several parallel requests finish", async () => {
    const service = createService();
    const results = await Promise.all([
      service.complete({ ...INPUT, databasePath }, token),
      service.complete({ ...INPUT, databasePath, username: "zweite" }, token),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "alreadyCompleted",
      "completed",
    ]);
    await expect(
      new UserRepository(activated[0] as Database).findAll(),
    ).resolves.toHaveLength(1);
  });

  it.each([
    ["", "empty"],
    ["relative.duckdb", "invalid"],
  ])("checks the path %j again before using it", async (input, location) => {
    await expect(
      createService().complete({ ...INPUT, databasePath: input }, token),
    ).resolves.toEqual({ location, status: "databaseLocation" });
  });

  it("never replaces a foreign file", async () => {
    await writeFile(databasePath, "my notes");

    await expect(
      createService().complete({ ...INPUT, databasePath }, token),
    ).resolves.toEqual({ location: "foreign", status: "databaseLocation" });
    await expect(readFile(databasePath, "utf8")).resolves.toBe("my notes");
  });

  it("leaves a file alone that appears while the database is prepared", async () => {
    const service = createService({
      openDatabase: async (filePath) => {
        if (filePath !== databasePath) {
          await writeFile(databasePath, "arrived meanwhile");
        }

        return Database.create(filePath);
      },
    });

    await expect(
      service.complete({ ...INPUT, databasePath }, token),
    ).resolves.toEqual({
      location: "foreign",
      status: "databaseLocation",
    });
    await expect(readFile(databasePath, "utf8")).resolves.toBe(
      "arrived meanwhile",
    );
    expect((await readdir(directory)).sort()).toEqual([
      "config.toml",
      "pages.duckdb",
    ]);
    expect(runtime.isSetupPending()).toBe(true);
  });

  it("copies the database where hard links are not supported", async () => {
    vi.mocked(link).mockRejectedValueOnce(
      Object.assign(new Error("cross-device"), { code: "EXDEV" }),
    );

    await expect(
      createService().complete({ ...INPUT, databasePath }, token),
    ).resolves.toMatchObject({ status: "completed" });
    expect(copyFile).toHaveBeenCalledTimes(1);
  });

  it("does not copy over a file that appears meanwhile", async () => {
    vi.mocked(link).mockRejectedValueOnce(new Error("not supported"));
    vi.mocked(copyFile).mockRejectedValueOnce(
      Object.assign(new Error("exists"), { code: "EEXIST" }),
    );

    await expect(
      createService().complete({ ...INPUT, databasePath }, token),
    ).resolves.toEqual({ location: "foreign", status: "databaseLocation" });
  });

  it("removes a partial copy when copying fails", async () => {
    vi.mocked(link).mockRejectedValueOnce(new Error("not supported"));
    vi.mocked(copyFile).mockImplementationOnce(async () => {
      await writeFile(databasePath, "partial");
      throw new Error("disk full");
    });

    await expect(
      createService().complete({ ...INPUT, databasePath }, token),
    ).resolves.toEqual({ status: "failed" });
    expect(await readdir(directory)).toEqual(["config.toml"]);
    expect(runtime.isSetupPending()).toBe(true);
  });

  it("refuses a staging database that kept unwritten changes", async () => {
    vi.mocked(existsSync).mockImplementation((filePath) =>
      String(filePath).endsWith(".wal"),
    );

    await expect(
      createService().complete({ ...INPUT, databasePath }, token),
    ).resolves.toEqual({ status: "failed" });

    vi.mocked(existsSync).mockRestore();
    expect(await readdir(directory)).toEqual(["config.toml"]);
  });

  it("reports refused accounts without creating a database", async () => {
    const service = createService({
      openDatabase: async (filePath) => {
        const database = await Database.create(filePath);

        await database.migrate(DATABASE_MIGRATIONS);
        await new UserRepository(database).insert({
          displayName: "Team",
          id: "team-1",
          passwordHash: "x",
          role: ROLE.EMPLOYEE,
          username: "chef",
        });

        return database;
      },
    });

    await expect(
      service.complete({ ...INPUT, databasePath }, token),
    ).resolves.toEqual({
      status: "usernameTaken",
    });
    expect(await readdir(directory)).toEqual(["config.toml"]);
  });

  it("closes an existing database that refuses the account", async () => {
    await createPagesDatabaseFile(databasePath, {
      users: [{ id: "team-1", role: ROLE.EMPLOYEE, username: "chef" }],
    });

    await expect(
      createService().complete({ ...INPUT, databasePath }, token),
    ).resolves.toEqual({ status: "usernameTaken" });
    await expect(
      readDatabase(databasePath, (database) =>
        new InstanceSettingsRepository(database).find(),
      ),
    ).resolves.toBeNull();
  });

  it("closes an existing database when writing fails", async () => {
    await createPagesDatabaseFile(databasePath);

    const service = createService({
      openDatabase: async (filePath) => {
        const database = await Database.create(filePath);

        vi.spyOn(database, "migrate").mockRejectedValueOnce(
          new Error("broken"),
        );

        return database;
      },
    });

    await expect(
      service.complete({ ...INPUT, databasePath }, token),
    ).resolves.toEqual({
      status: "failed",
    });
    await expect(
      readDatabase(databasePath, async () => "reopened"),
    ).resolves.toBe("reopened");
  });

  it("stays in setup mode when hashing fails", async () => {
    const passwordHasher = {
      hash: vi.fn().mockRejectedValue(new Error("no memory")),
    } as unknown as PasswordHasher;

    await expect(
      createService({ passwordHasher }).complete(
        { ...INPUT, databasePath },
        token,
      ),
    ).resolves.toEqual({ status: "failed" });
    expect(existsSync(databasePath)).toBe(false);
  });

  it("keeps the database and the token when the configuration cannot be stored", async () => {
    vi.spyOn(runtime.configFile, "update").mockRejectedValueOnce(
      new Error("read-only file system"),
    );

    await expect(
      createService().complete({ ...INPUT, databasePath }, token),
    ).resolves.toEqual({ status: "failed" });
    expect(runtime.isSetupPending()).toBe(true);
    expect(existsSync(databasePath)).toBe(true);
    await expect(runtime.configFile.read()).resolves.toMatchObject({
      firstRun: true,
    });

    const retry = await createService().complete(
      { ...INPUT, databasePath },
      token,
    );

    expect(retry.status).toBe("completed");
    await expect(
      new UserRepository(activated[0] as Database).findAll(),
    ).resolves.toHaveLength(1);
  });

  it("finishes even when the services cannot start right away", async () => {
    const failingActivation = vi.fn(async (database: Database) => {
      activated.push(database);
      throw new Error("scheduler failed");
    });

    await expect(
      createService({ activateServices: failingActivation }).complete(
        { ...INPUT, databasePath },
        token,
      ),
    ).resolves.toMatchObject({ status: "completed" });
    expect(console.error).toHaveBeenCalledWith(
      "[pages] The services could not be started.",
      expect.any(Error),
    );
  });
});
