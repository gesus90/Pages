import { beforeEach, describe, expect, it, vi } from "vitest";

import { AutomationService } from "./AutomationService";

import type { AutomationDirectory } from "./AutomationDirectory";

const mocks = vi.hoisted(() => ({
  access: { actor: vi.fn() },
  reads: {
    options: vi.fn(),
    list: vi.fn(),
    read: vi.fn(),
    runs: vi.fn(),
    run: vi.fn(),
    history: vi.fn(),
  },
  writes: {
    create: vi.fn(),
    update: vi.fn(),
    setActive: vi.fn(),
    run: vi.fn(),
    delete: vi.fn(),
  },
  preferences: { find: vi.fn(), save: vi.fn() },
  readsArguments: vi.fn(),
  writesArguments: vi.fn(),
  preferencesArguments: vi.fn(),
}));

vi.mock("./AutomationAccess", () => ({
  AutomationAccess: class {
    public actor = mocks.access.actor;
  },
}));

vi.mock("./AutomationReads", () => ({
  AutomationReads: class {
    public options = mocks.reads.options;
    public list = mocks.reads.list;
    public read = mocks.reads.read;
    public runs = mocks.reads.runs;
    public run = mocks.reads.run;
    public history = mocks.reads.history;
    public constructor(dependencies: unknown) {
      mocks.readsArguments(dependencies);
    }
  },
}));

vi.mock("./AutomationWrites", () => ({
  AutomationWrites: class {
    public create = mocks.writes.create;
    public update = mocks.writes.update;
    public setActive = mocks.writes.setActive;
    public run = mocks.writes.run;
    public delete = mocks.writes.delete;
    public constructor(dependencies: unknown) {
      mocks.writesArguments(dependencies);
    }
  },
}));

vi.mock(
  "@/backend/database/repositories/automation/AutomationNotificationPreferenceRepository",
  () => ({
    AutomationNotificationPreferenceRepository: class {
      public find = mocks.preferences.find;
      public save = mocks.preferences.save;
      public constructor(database: unknown) {
        mocks.preferencesArguments(database);
      }
    },
  }),
);

const database = { query: vi.fn(), execute: vi.fn(), transaction: vi.fn() };
const directory = { sharingNames: vi.fn() };
const fixedNow = new Date("2026-11-12T10:00:00.000Z");

function serviceOf(
  options: { now?: () => Date; wake?: () => void } = {},
): AutomationService {
  return new AutomationService({
    database,
    directory: directory as unknown as AutomationDirectory,
    ...options,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AutomationService", () => {
  it("wires its collaborators", () => {
    const wake = vi.fn();
    const service = serviceOf({ now: () => fixedNow, wake });
    expect(service.rules).toBeDefined();
    expect(mocks.readsArguments).toHaveBeenCalledWith(
      expect.objectContaining({ database, directory }),
    );
    expect(mocks.writesArguments).toHaveBeenCalledWith(
      expect.objectContaining({ database, wake }),
    );
    expect(mocks.preferencesArguments).toHaveBeenCalledWith(database);
  });

  it("falls back to the system clock", () => {
    serviceOf();
    const { now } = mocks.writesArguments.mock.calls[0]?.[0] as {
      now: () => Date;
    };
    expect(now()).toBeInstanceOf(Date);
  });

  it("delegates reads", async () => {
    const service = serviceOf();
    mocks.reads.options.mockResolvedValue("options");
    mocks.reads.list.mockResolvedValue("list");
    mocks.reads.read.mockResolvedValue("read");
    mocks.reads.runs.mockResolvedValue("runs");
    mocks.reads.run.mockResolvedValue("run");
    mocks.reads.history.mockResolvedValue("history");
    expect(await service.options("u")).toBe("options");
    expect(await service.list("u", { a: 1 })).toBe("list");
    expect(await service.read("u", { a: 2 })).toBe("read");
    expect(await service.runs("u", { a: 3 })).toBe("runs");
    expect(await service.run("u", { a: 4 })).toBe("run");
    expect(await service.history("u", { limit: 5 })).toBe("history");
    expect(mocks.reads.history).toHaveBeenCalledWith("u", { limit: 5 });
  });

  it("delegates writes", async () => {
    const service = serviceOf();
    mocks.writes.create.mockResolvedValue("create");
    mocks.writes.update.mockResolvedValue("update");
    mocks.writes.setActive.mockResolvedValue("active");
    mocks.writes.run.mockResolvedValue("receipt");
    mocks.writes.delete.mockResolvedValue("deleted");
    expect(await service.create("u", 1)).toBe("create");
    expect(await service.update("u", 2)).toBe("update");
    expect(await service.setActive("u", 3)).toBe("active");
    expect(await service.runNow("u", 4)).toBe("receipt");
    expect(await service.delete("u", 5)).toBe("deleted");
    expect(mocks.writes.run).toHaveBeenCalledWith("u", 4);
  });

  it("reads the sharing names from the directory", async () => {
    const names = new Map([["p", "Project"]]);
    directory.sharingNames.mockResolvedValue(names);
    expect(await serviceOf().sharingNames()).toBe(names);
  });

  it("reads the notification mode", async () => {
    mocks.preferences.find.mockResolvedValue("off");
    expect(await serviceOf().notificationMode("u")).toBe("off");
  });

  it("stores a known notification mode", async () => {
    const service = serviceOf({ now: () => fixedNow });
    expect(await service.setNotificationMode("u", "off")).toBe("off");
    expect(mocks.access.actor).toHaveBeenCalledWith("u");
    expect(mocks.preferences.save).toHaveBeenCalledWith(
      "u",
      "off",
      fixedNow.toISOString(),
    );
  });

  it("refuses an unknown notification mode", async () => {
    await expect(
      serviceOf().setNotificationMode("u", "sometimes"),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(mocks.preferences.save).not.toHaveBeenCalled();
  });
});
