import { beforeEach, expect, it, vi } from "vitest";

import { ProjectDeletionStorage } from "./ProjectDeletionStorage";

import type { ProjectDeletionFiles } from "@/backend/database/repositories/project/ProjectDeletionFiles";

const stores = vi.hoisted(() => ({
  wikiRemove: vi.fn(async () => {}),
  ticketRemove: vi.fn(async () => {}),
  wikiDirectory: vi.fn(),
  ticketDirectory: vi.fn(),
}));

vi.mock("@/backend/storage/WikiFileStore", () => ({
  WikiFileStore: class {
    public remove = stores.wikiRemove;
    public constructor(directory: string) {
      stores.wikiDirectory(directory);
    }
  },
}));
vi.mock("@/backend/storage/TicketFileStore", () => ({
  TicketFileStore: class {
    public remove = stores.ticketRemove;
    public constructor(directory: string) {
      stores.ticketDirectory(directory);
    }
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

it("stops runs and removes every kind of file", async () => {
  const runs = {
    stopProject: vi.fn(async () => {}),
    removeRunRecordFiles: vi.fn(async () => {}),
  };
  const storage = new ProjectDeletionStorage(runs, "/data");
  const files = {
    wikiAttachments: ["w"],
    ticketAttachments: ["t"],
    agentRunRecords: ["r"],
  } as unknown as ProjectDeletionFiles;

  await storage.stopRuns("p1");
  await storage.removeFiles(files);

  expect(stores.wikiDirectory).toHaveBeenCalledWith("/data/wiki-attachments");
  expect(stores.ticketDirectory).toHaveBeenCalledWith("/data");
  expect(runs.stopProject).toHaveBeenCalledWith("p1");
  expect(stores.wikiRemove).toHaveBeenCalledWith(["w"]);
  expect(stores.ticketRemove).toHaveBeenCalledWith(["t"]);
  expect(runs.removeRunRecordFiles).toHaveBeenCalledWith(["r"]);
});
