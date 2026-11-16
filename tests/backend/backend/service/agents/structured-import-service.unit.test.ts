import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";
import {
  manifestOf,
  projectSource,
} from "../agents-import/structured-manifest-fixture";

import type { StructuredImportDependencies } from "@/backend/service/agents/StructuredImportService";
import type { AgentIdentity } from "@/definition/McpAuthorization";

const boundary = vi.hoisted(() => ({
  environment: vi.fn(),
  find: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("@/backend/service/agents/StructuredImportEnvironment", () => ({
  createStructuredImportEnvironment: boundary.environment,
}));
vi.mock(
  "@/backend/database/repositories/agents/AgentOperationKeyRepository",
  () => ({
    AgentOperationKeyRepository: class {
      public find = boundary.find;
      public insert = boundary.insert;
    },
  }),
);

import { StructuredImportService } from "@/backend/service/agents/StructuredImportService";

const transaction = { query: vi.fn(), execute: vi.fn() };
const insertRun = vi.fn();
const listStoredItems = vi.fn();
const finishRun = vi.fn();
const environment = {
  actor: { id: "user" },
  viewer: { scope: { projectIds: ["project-1"] } },
  tasks: {
    projects: { canWriteProject: vi.fn() },
    permissions: { hasCapability: vi.fn() },
  },
  imports: { insertRun, listStoredItems, finishRun },
  assets: {},
  projects: {},
};
const service = new StructuredImportService(
  partial<StructuredImportDependencies>({
    creation: {
      database: {
        transaction: async (
          work: (value: typeof transaction) => Promise<unknown>,
        ) => work(transaction),
      },
    },
    planning: { tickets: {}, milestones: {}, announcer: {} },
  }),
);
const identity = partial<AgentIdentity>({ userId: "user" });
const manifest = manifestOf([projectSource()]);

beforeEach(() => {
  vi.resetAllMocks();
  environment.tasks.projects.canWriteProject.mockResolvedValue(true);
  environment.tasks.permissions.hasCapability.mockResolvedValue(true);
  boundary.environment.mockResolvedValue(environment);
  boundary.find.mockResolvedValue(null);
  listStoredItems.mockResolvedValue([]);
  finishRun.mockResolvedValue({
    created: 0,
    skipped: 0,
    conflict: 0,
    failed: 0,
  });
});

it("plans and applies a confirmed project reference without external effects", async () => {
  const plan = await service.plan(identity, { manifest });
  expect(plan.result).toMatchObject({
    valid: true,
    objects: [{ kind: "project", action: "reference" }],
    externalEffects: [],
  });
  const verify = vi.fn(async () => identity);
  const result = await service.apply(
    identity,
    { manifest, operationId: "op", fingerprint: plan.result.fingerprint },
    verify,
  );
  expect(result.result).toMatchObject({ status: "complete", items: [] });
  expect(insertRun).toHaveBeenCalledOnce();
  expect(boundary.insert).toHaveBeenCalledOnce();
  expect(verify).toHaveBeenCalledOnce();
});

it("rejects stale confirmation fingerprints before creating a run", async () => {
  await expect(
    service.apply(
      identity,
      { manifest, operationId: "op", fingerprint: "a".repeat(64) },
      async () => identity,
    ),
  ).rejects.toThrow();
  expect(insertRun).not.toHaveBeenCalled();
});

it("rejects a changed credential before returning results", async () => {
  const plan = await service.plan(identity, { manifest });
  await expect(
    service.apply(
      identity,
      { manifest, operationId: "op", fingerprint: plan.result.fingerprint },
      async () => partial<AgentIdentity>({ userId: "other" }),
    ),
  ).rejects.toThrow();
  expect(finishRun).not.toHaveBeenCalled();
});
