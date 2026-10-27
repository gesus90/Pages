import { rm } from "node:fs/promises";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectRunsActiveError } from "@/backend/error/ProjectErrors";
import { AgentRunArchive } from "@/backend/service/agents/AgentRunArchive";
import { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import { ProjectDeletionStorage } from "@/backend/service/project/ProjectDeletionStorage";

import type * as FileSystem from "node:fs/promises";
import type { Mock } from "vitest";

import type { PageAgentRunRepository } from "@/backend/database/repositories/agent/PageAgentRunRepository";
import type { ProjectRunControl } from "@/backend/service/project/ProjectDeletionStorage";

interface StorageFixture {
  runs: { [Key in keyof ProjectRunControl]: Mock<ProjectRunControl[Key]> };
  storage: ProjectDeletionStorage;
}

interface PlanServiceFixture {
  archive: { removeRecordFiles: Mock<() => Promise<void>> };
  engine: { stopProject: Mock<() => Promise<boolean>> };
  service: AgentPlanService;
}

const stores = vi.hoisted(
  () =>
    [] as { directory: string; remove: (names: string[]) => Promise<void> }[],
);

vi.mock("@/backend/storage/TicketFileStore", () => ({
  TicketFileStore: class {
    public readonly directory: string;
    public readonly remove = vi.fn(async (): Promise<void> => {});

    public constructor(directory: string) {
      this.directory = directory;
      stores.push(this);
    }
  },
}));
vi.mock("@/backend/storage/WikiFileStore", () => ({
  WikiFileStore: class {
    public readonly directory: string;
    public readonly remove = vi.fn(async (): Promise<void> => {});

    public constructor(directory: string) {
      this.directory = directory;
      stores.push(this);
    }
  },
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof FileSystem>()),
  rm: vi.fn(async () => {}),
}));

const FILES = {
  agentRunRecords: [{ agentId: "agent-1", runId: "run-1" }],
  ticketAttachments: ["ticket-file"],
  wikiAttachments: ["wiki-file-1", "wiki-file-2"],
};

beforeEach(() => {
  stores.length = 0;
});

describe("ProjectDeletionStorage", () => {
  function storage(): StorageFixture {
    const runs = {
      stopProject: vi.fn<ProjectRunControl["stopProject"]>(async () => {}),
      removeRunRecordFiles: vi.fn<ProjectRunControl["removeRunRecordFiles"]>(
        async () => {},
      ),
    };
    return { runs, storage: new ProjectDeletionStorage(runs, "/data") };
  }

  it("keeps the wiki attachments in their own directory and hands the data directory to the ticket store", () => {
    storage();
    // The ticket store resolves its `assets/` folders and the legacy folder itself.
    expect(stores.map(({ directory }) => directory)).toEqual([
      path.join("/data", "wiki-attachments"),
      "/data",
    ]);
  });

  it("removes every file kind from the store that holds it", async () => {
    const { runs, storage: effects } = storage();
    await effects.removeFiles(FILES);
    const [wiki, tickets] = stores;
    expect(wiki?.remove).toHaveBeenCalledWith(["wiki-file-1", "wiki-file-2"]);
    expect(tickets?.remove).toHaveBeenCalledWith(["ticket-file"]);
    expect(runs.removeRunRecordFiles).toHaveBeenCalledWith(
      FILES.agentRunRecords,
    );
  });

  it("hands the project to the plan runs for stopping", async () => {
    const { runs, storage: effects } = storage();
    await effects.stopRuns("project-1");
    expect(runs.stopProject).toHaveBeenCalledWith("project-1");
  });
});

describe("AgentPlanService, as far as a project deletion uses it", () => {
  type Dependencies = ConstructorParameters<typeof AgentPlanService>[0];
  function service(closed: boolean, withArchive = true): PlanServiceFixture {
    const engine = { stopProject: vi.fn(async () => closed) };
    const archive = { removeRecordFiles: vi.fn(async (): Promise<void> => {}) };
    return {
      archive,
      engine,
      service: new AgentPlanService({
        engine,
        ...(withArchive ? { archive } : {}),
      } as unknown as Dependencies),
    };
  }

  it("returns once the runs have closed", async () => {
    const { engine, service: plans } = service(true);
    await expect(plans.stopProject("project-1")).resolves.toBeUndefined();
    expect(engine.stopProject).toHaveBeenCalledWith("project-1");
  });

  it("refuses the deletion while a run does not close", async () => {
    await expect(
      service(false).service.stopProject("project-1"),
    ).rejects.toBeInstanceOf(ProjectRunsActiveError);
  });

  it("clears the record files through the archive, or does nothing without one", async () => {
    const { archive, service: plans } = service(true);
    await plans.removeRunRecordFiles(FILES.agentRunRecords);
    expect(archive.removeRecordFiles).toHaveBeenCalledWith(
      FILES.agentRunRecords,
    );
    await expect(
      service(true, false).service.removeRunRecordFiles(FILES.agentRunRecords),
    ).resolves.toBeUndefined();
  });
});

describe("AgentRunArchive.removeRecordFiles", () => {
  // Removing record files only touches the file system, never the repository.
  const repository = {} as unknown as PageAgentRunRepository;
  const archive = new AgentRunArchive(repository, "/agents");

  it("removes the markdown file of each record and ignores a missing one", async () => {
    await archive.removeRecordFiles([
      { agentId: "agent-1", runId: "run-1" },
      { agentId: "agent-2", runId: "run-2" },
    ]);
    expect(vi.mocked(rm).mock.calls).toEqual([
      [path.join("/agents", "agent-1", "runs", "run-1.md"), { force: true }],
      [path.join("/agents", "agent-2", "runs", "run-2.md"), { force: true }],
    ]);
  });

  it("rejects an identifier that could leave the run directory before removing anything", async () => {
    vi.mocked(rm).mockClear();
    await expect(
      archive.removeRecordFiles([
        { agentId: "agent-1", runId: "run-1" },
        { agentId: "agent-1", runId: "../../secrets" },
      ]),
    ).rejects.toMatchObject({ code: "profile_invalid" });
    expect(rm).not.toHaveBeenCalled();
  });
});
