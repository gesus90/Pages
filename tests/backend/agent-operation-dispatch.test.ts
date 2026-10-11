import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { createAgentPlanningServices } from "@/backend/service/agents/AgentPlanningServices";
import { AgentWikiCommentService } from "@/backend/service/agents/AgentWikiCommentService";
import { AgentWikiFieldService } from "@/backend/service/agents/AgentWikiFieldService";
import { StructuredImportService } from "@/backend/service/agents/StructuredImportService";
import { WikiImportService } from "@/backend/service/agents/WikiImportService";
import { WikiImportUpdateService } from "@/backend/service/agents/WikiImportUpdateService";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

import { useMigratedDatabase } from "../helpers/test-database";

import type { AgentOperationDependencies } from "@/backend/service/agents/AgentOperationRouter";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type {
  PagesAgentReadResponse,
  PagesAgentStructuredReadResponse,
} from "@/definition/PagesAgentOperations";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { User } from "@/definition/User";

const identity: AgentIdentity = {
  userId: "caller",
  isAdmin: false,
  permissions: ["write"],
};
const writeResponse: PagesAgentWriteResponse = {
  apiVersion: "1",
  result: { pageId: "page", link: "/wiki/page", assets: [] },
};
const readResponse: PagesAgentReadResponse = {
  apiVersion: "1",
  result: { id: "visible", name: "Visible" },
};
const planResponse: PagesAgentStructuredReadResponse = {
  apiVersion: "1",
  result: {
    fingerprint: "f".repeat(64),
    projects: [],
    objects: [],
    edges: [],
    errors: [],
    conflicts: [],
    assets: [],
    links: [],
    valid: true,
    externalEffects: [],
  },
};
const getDatabase = useMigratedDatabase();

function setup() {
  const database = getDatabase();
  const users = {
    getById: vi
      .fn<(id: string) => Promise<User | null>>()
      .mockResolvedValue(null),
  };
  const creation = {
    database,
    events: new PagesEventPublisher(),
    staging: new WikiFileStore(tmpdir()),
    wikiFiles: new WikiFileStore(tmpdir()),
  };
  const planning = createAgentPlanningServices({
    database,
    users,
    events: creation.events,
    cache: ServerCache.disabled(),
    publisher: null,
  });
  const dependencies = {
    users,
    projects: new ProjectRepository(database),
    wiki: new WikiRepository(database),
    imports: new WikiImportService(creation),
    importUpdates: new WikiImportUpdateService(creation),
    structured: new StructuredImportService({ creation, planning }),
    fields: new AgentWikiFieldService(creation),
    comments: new AgentWikiCommentService(creation),
    planning,
  };
  const methods = {
    ticketRead: vi
      .spyOn(planning.reads, "readTicket")
      .mockResolvedValue(readResponse),
    milestoneRead: vi
      .spyOn(planning.reads, "readMilestones")
      .mockResolvedValue(readResponse),
    ticketWrite: vi
      .spyOn(planning.tickets, "apply")
      .mockResolvedValue(writeResponse),
    milestoneWrite: vi
      .spyOn(planning.milestones, "apply")
      .mockResolvedValue(writeResponse),
    commentRead: vi
      .spyOn(dependencies.comments, "read")
      .mockResolvedValue(readResponse),
    commentWrite: vi
      .spyOn(dependencies.comments, "apply")
      .mockResolvedValue(writeResponse),
    fields: vi
      .spyOn(dependencies.fields, "apply")
      .mockResolvedValue(writeResponse),
    imports: vi
      .spyOn(dependencies.imports, "apply")
      .mockResolvedValue(writeResponse),
    updates: vi
      .spyOn(dependencies.importUpdates, "update")
      .mockResolvedValue(writeResponse),
    structuredPlan: vi
      .spyOn(dependencies.structured, "plan")
      .mockResolvedValue(planResponse),
    structuredApply: vi
      .spyOn(dependencies.structured, "apply")
      .mockResolvedValue(writeResponse),
  };
  return {
    dependencies,
    methods,
    router: new AgentOperationRouter(dependencies),
  };
}

describe("operation router read delegation", () => {
  it.each([
    ["ticket.read", "ticketRead"],
    ["milestones.read", "milestoneRead"],
    ["wiki.comments.read", "commentRead"],
    ["import.structured.plan", "structuredPlan"],
  ] as const)(
    "forwards %s without requiring a write verifier",
    async (operation, method) => {
      const run = setup();
      const parameters = { target: "explicit" };
      const result = await run.router.handle(identity, {
        operation,
        parameters,
      });
      expect(result).toBe(
        operation === "import.structured.plan" ? planResponse : readResponse,
      );
      expect(run.methods[method]).toHaveBeenCalledExactlyOnceWith(
        identity,
        parameters,
      );
      expect(run.dependencies.users.getById).not.toHaveBeenCalled();
    },
  );
});

describe("operation router write delegation", () => {
  it.each([
    ["ticket.create", "ticketWrite"],
    ["ticket.setTitle", "ticketWrite"],
    ["milestone.create", "milestoneWrite"],
    ["milestone.setName", "milestoneWrite"],
    ["wiki.comment.add", "commentWrite"],
    ["wiki.comment.edit", "commentWrite"],
    ["wiki.comment.resolve", "commentWrite"],
    ["wiki.comment.delete", "commentWrite"],
    ["wiki.page.setTitle", "fields"],
    ["wiki.page.setContent", "fields"],
    ["wiki.page.setIcon", "fields"],
    ["wiki.page.move", "fields"],
  ] as const)(
    "forwards the exact identity and parameters of %s",
    async (operation, method) => {
      const run = setup();
      const parameters = { operationId: "operation", target: "explicit" };
      expect(await run.router.handle(identity, { operation, parameters })).toBe(
        writeResponse,
      );
      expect(run.methods[method]).toHaveBeenCalledExactlyOnceWith(
        identity,
        operation,
        parameters,
      );
      const failure = new AgentOperationError("FORBIDDEN");
      run.methods[method].mockRejectedValueOnce(failure);
      await expect(
        run.router.handle(identity, { operation, parameters }),
      ).rejects.toBe(failure);
    },
  );
});

describe("operation router import delegation", () => {
  it.each([
    ["wiki.import.apply", "imports"],
    ["wiki.import.update", "updates"],
    ["import.structured.apply", "structuredApply"],
  ] as const)(
    "passes the original revalidation callback to %s",
    async (operation, method) => {
      const run = setup();
      const verify = vi
        .fn<() => Promise<AgentIdentity>>()
        .mockResolvedValue(identity);
      const parameters = { operationId: "operation" };
      expect(
        await run.router.handle(identity, { operation, parameters }, verify),
      ).toBe(writeResponse);
      expect(run.methods[method]).toHaveBeenCalledExactlyOnceWith(
        identity,
        parameters,
        verify,
      );
      expect(verify).not.toHaveBeenCalled();
    },
  );
});

describe("operation router fails closed", () => {
  it("rejects upload preparation when its write collaborator is unavailable", async () => {
    const run = setup();
    await expect(
      run.router.prepareUpload(identity, "isolated-test-token", {
        fileName: "image.png",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 400 });
  });

  it.each([
    ["ticket.read", "planning"],
    ["milestones.read", "planning"],
    ["ticket.create", "planning"],
    ["milestone.create", "planning"],
    ["wiki.comments.read", "comments"],
    ["wiki.comment.add", "comments"],
    ["wiki.page.setTitle", "fields"],
    ["wiki.page.move", "fields"],
    ["wiki.import.apply", "imports"],
    ["wiki.import.update", "importUpdates"],
    ["import.structured.plan", "structured"],
    ["import.structured.apply", "structured"],
  ] as const)(
    "rejects %s when its collaborator is unavailable",
    async (operation, dependency) => {
      const run = setup();
      const unavailable: AgentOperationDependencies = {
        ...run.dependencies,
        [dependency]: undefined,
      };
      await expect(
        new AgentOperationRouter(unavailable).handle(
          identity,
          { operation },
          async () => identity,
        ),
      ).rejects.toMatchObject({
        code: "INVALID_REQUEST",
        status: 400,
      });
      for (const method of Object.values(run.methods))
        expect(method).not.toHaveBeenCalled();
    },
  );

  it.each([
    "wiki.import.apply",
    "wiki.import.update",
    "import.structured.apply",
  ])("rejects %s without credential revalidation", async (operation) => {
    const run = setup();
    await expect(
      run.router.handle(identity, { operation }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 400 });
    for (const method of Object.values(run.methods))
      expect(method).not.toHaveBeenCalled();
  });
});
