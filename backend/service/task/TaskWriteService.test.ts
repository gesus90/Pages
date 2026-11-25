import { expect, it, vi } from "vitest";

import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";
import { OperationReusedError } from "@/backend/service/InterfaceOperationJournal";

import { TaskWriteService } from "./TaskWriteService";

import type {
  CreateWorkItemInput,
  DescriptionChange,
  UpdateWorkItemInput,
} from "./TaskWriteService";
import type { TaskDescriptionAssetService } from "./TaskDescriptionAssetService";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

type Mock = ReturnType<typeof vi.fn>;

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

const actor = doubleOf<User>({ id: "u1" });
const visibility = { departmentIds: [], projectIds: ["p1"] };

function itemOf(overrides: Record<string, unknown> = {}): WorkItemDetail {
  return doubleOf<WorkItemDetail>({
    archivedAt: null,
    assigneeGroupId: null,
    description: "old",
    id: "t1",
    milestoneId: null,
    parentId: null,
    parentKey: null,
    projectId: "p1",
    type: "task",
    ...overrides,
  });
}

interface Facts {
  readonly existing?: WorkItemDetail;
  readonly status?: object | null;
  readonly hiddenParent?: object | null;
  readonly isUpdated?: boolean;
  readonly storedId?: string | null;
}

function setup(facts: Facts = {}): {
  readonly service: TaskWriteService;
  readonly repository: Record<string, Mock>;
  readonly access: Record<string, Mock>;
  readonly history: Record<string, Mock>;
  readonly validator: Record<string, Mock>;
  readonly publish: Mock;
  readonly threadAssignedTask: Mock;
  readonly invalidate: Mock;
} {
  const saved = new Map<string, { operation: string; fingerprint: string }>();
  const operations = {
    find: vi.fn(async (userId: string, id: string) => saved.get(id) ?? null),
    insert: vi.fn(
      async (
        userId: string,
        id: string,
        entry: { operation: string; fingerprint: string },
      ) => {
        saved.set(id, entry);
      },
    ),
    removeOlder: vi.fn(async () => {}),
  };
  const stored = itemOf({ description: "new", id: "stored" });
  const repository: Record<string, Mock> = {
    findById: vi.fn(async () => (facts.storedId === null ? null : stored)),
    findParentReference: vi.fn(async () => facts.hiddenParent ?? null),
    findStatusById: vi.fn(async () =>
      facts.status === undefined
        ? { id: "s1", isDone: false, projectId: "p1" }
        : facts.status,
    ),
    insert: vi.fn(async () => {}),
    storedTextForm: vi.fn(async (text: string) =>
      text.replaceAll("\u0000", ""),
    ),
    update: vi.fn(async () => facts.isUpdated ?? true),
    updateDescription: vi.fn(async () => facts.isUpdated ?? true),
    updateParent: vi.fn(async () => {}),
    updateStatusAndOrder: vi.fn(async () => {}),
  };
  const taskRepository = { ...repository, operations };
  const access: Record<string, Mock> = {
    requireWritableProject: vi.fn(async () => ({ id: "p1", name: "Pages" })),
    requireWritableWorkItem: vi.fn(async () => facts.existing ?? itemOf()),
    requireWorkItem: vi.fn(async () => {}),
    visibility: vi.fn(async () => visibility),
  };
  const history: Record<string, Mock> = {
    recordCreated: vi.fn(async () => {}),
    recordDescriptionChanged: vi.fn(async () => {}),
    recordParentChanged: vi.fn(async () => {}),
    recordStatusMove: vi.fn(async () => {}),
    recordUpdate: vi.fn(async () => {}),
  };
  const validator: Record<string, Mock> = {
    validateAssignee: vi.fn(async () => {}),
    validateHierarchy: vi.fn(async () => {}),
    validateReferences: vi.fn(async () => {}),
  };
  const publish = vi.fn(async () => {});
  const threadAssignedTask = vi.fn(async () => {});
  const invalidate = vi.fn();
  const service = new TaskWriteService({
    access: doubleOf(access),
    cache: doubleOf({ invalidateWorkItems: invalidate }),
    departments: doubleOf({ resolve: vi.fn(async () => ["d1"]) }),
    gitHubPublisher: doubleOf({ publish }),
    history: doubleOf(history),
    milestoneLinks: doubleOf({ threadAssignedTask }),
    numbering: doubleOf({
      run: vi.fn(
        async (
          project: unknown,
          count: number,
          work: (sequence: object) => Promise<string>,
        ) => work({ firstNumber: 7, projectKey: "PAGE" }),
      ),
    }),
    taskRepository: doubleOf(taskRepository),
    validator: doubleOf(validator),
  });
  return {
    access,
    history,
    invalidate,
    publish,
    repository: { ...repository, operationsFind: operations.find },
    service,
    threadAssignedTask,
    validator,
  };
}

function createInput(
  overrides: Partial<CreateWorkItemInput> = {},
): CreateWorkItemInput {
  return {
    projectId: "p1",
    statusId: "s1",
    title: " Title ",
    type: "task",
    ...overrides,
  };
}

function updateInput(
  overrides: Partial<UpdateWorkItemInput> = {},
): UpdateWorkItemInput {
  return {
    assigneeId: null,
    dueAt: null,
    milestoneId: null,
    parentId: null,
    priority: "normal",
    reporterId: "r1",
    startAt: null,
    statusId: "s1",
    title: " Title ",
    ...overrides,
  };
}

it("creates a numbered work item and publishes it", async () => {
  const { service, repository, history, publish, threadAssignedTask } = setup();

  const created = await service.create(
    actor,
    createInput({ description: " text ", dueAt: " 2026-01-01 " }),
  );

  expect(created.id).toBe("stored");
  expect(repository.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      createdBy: "u1",
      departmentIds: ["d1"],
      description: "text",
      dueAt: "2026-01-01",
      key: "PAGE-7",
      number: 7,
      priority: "normal",
      statusId: "s1",
      title: "Title",
    }),
  );
  expect(history.recordCreated).toHaveBeenCalled();
  expect(repository.findById).toHaveBeenCalledWith(
    expect.any(String),
    undefined,
  );
  expect(threadAssignedTask).toHaveBeenCalledWith(actor, created);
  expect(publish).toHaveBeenCalledWith(actor, created);
});

it("creates without GitHub sync and accepts a global status", async () => {
  const { service, publish } = setup({
    status: { id: "s1", isDone: false, projectId: null },
  });

  await service.create(
    actor,
    createInput({ priority: "high", skipGitHubSync: true }),
  );

  expect(publish).not.toHaveBeenCalled();
});

it.each([
  ["unsupported type", { type: "bogus" }, undefined, "typeUnsupported"],
  [
    "unsupported priority",
    { priority: "bogus" },
    undefined,
    "priorityUnsupported",
  ],
  ["empty title", { title: " " }, undefined, "titleLength"],
  ["missing status", {}, { status: null }, "statusNotFound"],
  [
    "foreign status",
    {},
    { status: { id: "s1", projectId: "other" } },
    "statusNotFound",
  ],
])("refuses to create with %s", async (name, input, facts, code) => {
  const { service } = setup(facts);

  await expect(
    service.create(actor, createInput(input as Partial<CreateWorkItemInput>)),
  ).rejects.toMatchObject({ code });
});

it("fails when the created work item cannot be read back", async () => {
  const { service } = setup({ storedId: null });

  await expect(service.create(actor, createInput())).rejects.toThrow(
    "Created work item could not be retrieved.",
  );
});

it("refuses descriptions that reference foreign files without asset storage", async () => {
  const { service } = setup();

  await expect(
    service.create(
      actor,
      createInput({ description: "![a](https://example.test/a.png)" }),
    ),
  ).rejects.toThrow(WorkItemValidationError);
  await expect(
    service.create(
      actor,
      createInput({ description: "![a](/agent-assets/x1)" }),
    ),
  ).rejects.toThrow(WorkItemValidationError);
  await expect(
    service.create(
      actor,
      createInput({
        description: "![a](/aufgaben/attachments/x1) [b](https://e.test)",
      }),
    ),
  ).resolves.toBeDefined();
});

it("writes a created description through the asset service", async () => {
  const { service, repository, access } = setup();
  const save = vi.fn(
    async (
      input: { authorizeTicket: (id: string) => Promise<void> },
      work: (target: object, text: string) => Promise<unknown>,
    ) => {
      await input.authorizeTicket("t9");
      return work({ insert: repository.insert }, "rewritten");
    },
  );
  service.setDescriptionAssets(doubleOf<TaskDescriptionAssetService>({ save }));

  await service.create(actor, createInput({ description: "d" }));

  expect(access.requireWorkItem).toHaveBeenCalledWith(actor, "t9");
  expect(repository.insert).toHaveBeenCalledWith(
    expect.objectContaining({ description: "rewritten" }),
  );
});

it("updates a work item without touching its description", async () => {
  const { service, repository, history, publish, threadAssignedTask } = setup();

  const updated = await service.update(actor, "t1", updateInput());

  expect(repository.update).toHaveBeenCalledWith(
    "t1",
    expect.objectContaining({
      description: "old",
      shouldPreserveDescription: true,
      statusId: "s1",
    }),
  );
  expect(history.recordUpdate).toHaveBeenCalled();
  expect(threadAssignedTask).not.toHaveBeenCalled();
  expect(publish).toHaveBeenCalledWith(actor, updated);
});

it("reports a conflict when an update without description changes nothing", async () => {
  const plain = setup({ isUpdated: false });
  await expect(
    plain.service.update(actor, "t1", updateInput()),
  ).rejects.toMatchObject({ code: "descriptionConflict" });

  const guarded = setup({ isUpdated: false });
  await expect(
    guarded.service.update(
      actor,
      "t1",
      updateInput({ expected: doubleOf({ parentId: null }) }),
    ),
  ).rejects.toMatchObject({ code: "ticketConflict" });
});

it("updates the description with the base text and threads a new milestone", async () => {
  const { service, repository, threadAssignedTask } = setup();

  await service.update(
    actor,
    "t1",
    updateInput({
      baseDescription: "old",
      description: " new ",
      milestoneId: "m1",
    }),
  );

  expect(repository.update).toHaveBeenCalledWith(
    "t1",
    expect.objectContaining({
      baseDescription: "old",
      description: "new",
      milestoneId: "m1",
    }),
  );
  expect(threadAssignedTask).toHaveBeenCalled();
});

it.each([
  "new",
  " padded ",
  "",
  "nul\u0000l",
  "line\nbreak",
  "# heading",
  "[link](https://example.test)",
  "- item",
  "`code`",
  "tail ",
])("stores the description %j of an update", async (description) => {
  const { service, repository } = setup();

  await service.update(actor, "t1", updateInput({ description }));

  expect(repository.update).toHaveBeenCalledWith(
    "t1",
    expect.objectContaining({ description: description.trim() }),
  );
});

it("falls back to the stored description as base when none is given", async () => {
  const { service, repository } = setup();

  await service.update(actor, "t1", updateInput({ description: "new" }));

  expect(repository.update).toHaveBeenCalledWith(
    "t1",
    expect.objectContaining({ baseDescription: "old" }),
  );
});

it("refuses an update from an outdated description", async () => {
  const { service } = setup();

  await expect(
    service.update(
      actor,
      "t1",
      updateInput({ baseDescription: "other", description: "new" }),
    ),
  ).rejects.toMatchObject({ code: "descriptionConflict" });
});

it("reports conflicts of an update that carries a description", async () => {
  const plain = setup({ isUpdated: false });
  await expect(
    plain.service.update(actor, "t1", updateInput({ description: "new" })),
  ).rejects.toMatchObject({ code: "descriptionConflict" });

  const guarded = setup({ isUpdated: false });
  await expect(
    guarded.service.update(
      actor,
      "t1",
      updateInput({
        description: "new",
        expected: doubleOf({ parentId: "x" }),
      }),
    ),
  ).rejects.toMatchObject({ code: "ticketConflict" });
});

it("keeps a parent the actor cannot see", async () => {
  const { service, repository, validator } = setup({
    hiddenParent: { id: "hp", key: "PAGE-1" },
  });

  await service.update(
    actor,
    "t1",
    updateInput({ expected: doubleOf({ parentId: null }) }),
  );
  await service.update(
    actor,
    "t1",
    updateInput({ expected: doubleOf({ parentId: "hp" }), parentId: "np" }),
  );

  expect(validator.validateReferences).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ parentId: "hp", preservedParentId: "hp" }),
  );
  expect(repository.update).toHaveBeenNthCalledWith(
    1,
    "t1",
    expect.objectContaining({ expected: { parentId: "hp" }, parentId: "hp" }),
  );
  expect(validator.validateReferences).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ parentId: "np", preservedParentId: null }),
  );
});

it("does not look up a hidden parent of a work item with a parent", async () => {
  const { service, repository } = setup({
    existing: itemOf({ parentId: "p0" }),
  });

  await service.update(actor, "t1", updateInput({ parentId: "p0" }));

  expect(repository.findParentReference).not.toHaveBeenCalled();
});

it.each([
  [
    "unsupported priority",
    { priority: "bogus" },
    undefined,
    "priorityUnsupported",
  ],
  ["missing status", {}, { status: null }, "statusNotFound"],
  [
    "foreign status",
    {},
    { status: { id: "s", projectId: "x" } },
    "statusNotFound",
  ],
  ["empty reporter", { reporterId: " " }, undefined, "reporterRequired"],
])("refuses to update with %s", async (name, input, facts, code) => {
  const { service } = setup(facts);

  await expect(
    service.update(
      actor,
      "t1",
      updateInput(input as Partial<UpdateWorkItemInput>),
    ),
  ).rejects.toMatchObject({ code });
});

it("accepts a global status when updating", async () => {
  const { service } = setup({
    status: { id: "s1", isDone: false, projectId: null },
  });

  await expect(
    service.update(actor, "t1", updateInput()),
  ).resolves.toBeDefined();
});

it("fails when the updated work item cannot be read back", async () => {
  const { service } = setup({ storedId: null });

  await expect(service.update(actor, "t1", updateInput())).rejects.toThrow(
    "Updated work item could not be retrieved.",
  );
});

function change(overrides: Partial<DescriptionChange> = {}): DescriptionChange {
  return { baseDescription: "old", description: " new ", ...overrides };
}

it("saves a new description and records it", async () => {
  const { service, repository, history, publish } = setup();

  const updated = await service.updateDescription(actor, "t1", change());

  expect(repository.updateDescription).toHaveBeenCalledWith("t1", "new", "old");
  expect(history.recordDescriptionChanged).toHaveBeenCalledWith(
    actor,
    expect.objectContaining({ id: "t1" }),
    "new",
  );
  expect(publish).toHaveBeenCalledWith(actor, updated);
});

it("stores a verbatim description untrimmed", async () => {
  const { service, repository } = setup();

  await service.updateDescription(
    actor,
    "t1",
    change({ description: " new ", isVerbatim: true }),
  );

  expect(repository.updateDescription).toHaveBeenCalledWith(
    "t1",
    " new ",
    "old",
  );
});

it("returns the work item when the description is already stored", async () => {
  const existing = itemOf();
  const { service, repository, history } = setup({ existing });

  await expect(
    service.updateDescription(actor, "t1", change({ description: "old" })),
  ).resolves.toBe(existing);

  expect(repository.updateDescription).not.toHaveBeenCalled();
  expect(history.recordDescriptionChanged).not.toHaveBeenCalled();
});

it("refuses an archived work item, a long text and an outdated base", async () => {
  const archived = setup({ existing: itemOf({ archivedAt: "2026-01-01" }) });
  await expect(
    archived.service.updateDescription(actor, "t1", change()),
  ).rejects.toMatchObject({ code: "ticketArchived" });

  const { service } = setup();
  await expect(
    service.updateDescription(
      actor,
      "t1",
      change({ description: "x".repeat(70_000) }),
    ),
  ).rejects.toMatchObject({ code: "descriptionTooLong" });
  await expect(
    service.updateDescription(actor, "t1", change({ baseDescription: "zzz" })),
  ).rejects.toMatchObject({ code: "descriptionConflict" });
});

it("reports a conflict when the description changed meanwhile", async () => {
  const { service } = setup({ isUpdated: false });

  await expect(
    service.updateDescription(actor, "t1", change()),
  ).rejects.toMatchObject({ code: "descriptionConflict" });
});

it("answers a repeated operation with the first result", async () => {
  const { service, repository } = setup();
  const first = change({ operationId: "op1" });

  await service.updateDescription(actor, "t1", first);
  const repeated = await service.updateDescription(actor, "t1", first);

  expect(repeated.description).toBe("new");
  expect(repository.updateDescription).toHaveBeenCalledTimes(1);
  await expect(
    service.updateDescription(
      actor,
      "t1",
      change({ description: "other", operationId: "op1" }),
    ),
  ).rejects.toThrow(OperationReusedError);
});

it("records an operation when the stored form of the text is unchanged", async () => {
  const { service, repository } = setup();

  await service.updateDescription(
    actor,
    "t1",
    change({ description: "ol\u0000d", operationId: "op2" }),
  );

  expect(repository.updateDescription).not.toHaveBeenCalled();
  expect(repository.operationsFind).toHaveBeenCalled();
});

it("changes the parent of a work item", async () => {
  const { service, repository, validator, history } = setup();

  await service.changeParent(actor, "t1", " np ");

  expect(validator.validateHierarchy).toHaveBeenCalledWith(
    expect.objectContaining({ parentId: "np", storedParentId: null }),
  );
  expect(repository.updateParent).toHaveBeenCalledWith("t1", "np");
  expect(history.recordParentChanged).toHaveBeenCalledWith(actor, {
    newParentId: "np",
    oldParentKey: null,
    workItemId: "t1",
  });
});

it("leaves the parent when it stays the same", async () => {
  const existing = itemOf({ parentId: "p0" });
  const { service, repository } = setup({ existing });

  await expect(service.changeParent(actor, "t1", "p0")).resolves.toBe(existing);

  expect(repository.updateParent).not.toHaveBeenCalled();
  expect(repository.findParentReference).not.toHaveBeenCalled();
});

it("keeps a hidden parent when the actor chooses none", async () => {
  const existing = itemOf();
  const { service, repository } = setup({
    existing,
    hiddenParent: { id: "hp", key: "PAGE-1" },
  });

  await expect(service.changeParent(actor, "t1", null)).resolves.toBe(existing);
  await service.changeParent(actor, "t1", "np");

  expect(repository.updateParent).toHaveBeenCalledWith("t1", "np");
});

it("removes the parent and refuses archived work items", async () => {
  const existing = itemOf({ parentId: "p0" });
  const { service, repository } = setup({ existing });

  await service.changeParent(actor, "t1", null);

  expect(repository.updateParent).toHaveBeenCalledWith("t1", null);

  const archived = setup({ existing: itemOf({ archivedAt: "2026-01-01" }) });
  await expect(
    archived.service.changeParent(actor, "t1", "np"),
  ).rejects.toMatchObject({ code: "ticketArchived" });
});

it("moves a work item to another status and order", async () => {
  const { service, repository, history, publish } = setup({
    status: { id: "s2", isDone: true, projectId: null },
  });

  const updated = await service.updateStatusAndOrder(actor, "t1", "s2", 3);

  expect(repository.updateStatusAndOrder).toHaveBeenCalledWith(
    "t1",
    "s2",
    3,
    true,
  );
  expect(history.recordStatusMove).toHaveBeenCalled();
  expect(publish).toHaveBeenCalledWith(actor, updated);
});

it("refuses a move to a missing or foreign status", async () => {
  const missing = setup({ status: null });
  await expect(
    missing.service.updateStatusAndOrder(actor, "t1", "s2", 1),
  ).rejects.toMatchObject({ code: "targetStatusNotFound" });

  const foreign = setup({ status: { id: "s2", projectId: "x" } });
  await expect(
    foreign.service.updateStatusAndOrder(actor, "t1", "s2", 1),
  ).rejects.toMatchObject({ code: "targetStatusNotFound" });

  const own = setup({ status: { id: "s2", isDone: false, projectId: "p1" } });
  await expect(
    own.service.updateStatusAndOrder(actor, "t1", "s2", 1),
  ).resolves.toBeDefined();
});
