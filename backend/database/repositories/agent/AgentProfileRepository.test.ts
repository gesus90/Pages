import { beforeEach, expect, it, vi } from "vitest";

import { AgentProfileRemoval } from "./AgentProfileRemoval";
import { AgentProfileRepository } from "./AgentProfileRepository";
import { AgentProfileStore } from "./AgentProfileStore";
import { AgentWorkspaceReferencesRepository } from "./AgentWorkspaceReferencesRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AgentProfile } from "@/definition/AgentProfile";

const mocks = vi.hoisted(() => ({
  requireReferences: vi.fn(async () => {}),
  list: vi.fn(async () => []),
  save: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  usages: vi.fn(async () => []),
  removeWithReferences: vi.fn(async () => {}),
}));

vi.mock("./AgentWorkspaceReferencesRepository", () => ({
  AgentWorkspaceReferencesRepository: vi.fn(
    class {
      public requireReferences = mocks.requireReferences;
    },
  ),
}));
vi.mock("./AgentProfileStore", () => ({
  AgentProfileStore: vi.fn(
    class {
      public list = mocks.list;
      public save = mocks.save;
      public remove = mocks.remove;
      public usages = mocks.usages;
    },
  ),
}));
vi.mock("./AgentProfileRemoval", () => ({
  AgentProfileRemoval: vi.fn(
    class {
      public remove = mocks.removeWithReferences;
    },
  ),
}));

const TRANSACTION: DatabaseTransaction = {
  execute: async () => {},
  query: async () => [],
};

const PROFILE: AgentProfile = {
  id: "p1",
  name: "Profile",
  connectionId: "c1",
  model: "m1",
  reasoningEffort: null,
  isActive: true,
  purposes: ["chat"],
  targets: [],
};

function repositoryOf(): AgentProfileRepository {
  return new AgentProfileRepository({
    transaction: async (work) => work(TRANSACTION),
    readTransaction: async (work) => work(TRANSACTION),
  } satisfies Pick<Database, "transaction" | "readTransaction">);
}

beforeEach(() => {
  vi.clearAllMocks();
});

it("lists profiles in a read transaction", async () => {
  await expect(repositoryOf().list()).resolves.toEqual([]);
  expect(AgentProfileStore).toHaveBeenCalledWith(TRANSACTION);
  expect(mocks.list).toHaveBeenCalledOnce();
});

it("saves a profile after checking its workspace references", async () => {
  await repositoryOf().save(PROFILE);
  expect(AgentWorkspaceReferencesRepository).toHaveBeenCalledWith(TRANSACTION);
  expect(mocks.requireReferences).toHaveBeenCalledWith(undefined);
  expect(mocks.save).toHaveBeenCalledWith(PROFILE);
});

it("runs the journal with the saved profile", async () => {
  const journal = vi.fn(async () => {});
  await repositoryOf().save(PROFILE, journal);
  expect(journal).toHaveBeenCalledWith(TRANSACTION, PROFILE);
});

it("removes a profile without options", async () => {
  await repositoryOf().remove("p1");
  expect(mocks.remove).toHaveBeenCalledWith("p1", undefined);
});

it("removes a profile with a revision check and a journal", async () => {
  const journal = vi.fn(async () => {});
  await repositoryOf().remove("p1", { expectedRevision: 2, journal });
  expect(mocks.remove).toHaveBeenCalledWith("p1", 2);
  expect(journal).toHaveBeenCalledWith(TRANSACTION);
});

it("removes a profile together with its references", async () => {
  await repositoryOf().removeWithReferences("p1");
  expect(AgentProfileRemoval).toHaveBeenCalledWith(TRANSACTION);
  expect(mocks.removeWithReferences).toHaveBeenCalledWith("p1");
});

it("reads the usages of a profile in a read transaction", async () => {
  await expect(repositoryOf().usages("p1")).resolves.toEqual([]);
  expect(mocks.usages).toHaveBeenCalledWith("p1");
});
