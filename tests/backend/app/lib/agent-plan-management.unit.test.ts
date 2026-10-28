import { expect, it, vi } from "vitest";

import {
  clonePlanAction,
  createPlanAction,
  deletePlanAction,
} from "@/app/lib/agent-plan-management.server";
import { AgentError } from "@/backend/error/AgentErrors";

import { formOf, outcomeOf, servicesOf } from "../actions/action-fixtures";

import type { FormFields } from "../actions/action-fixtures";

interface PlanFakes {
  readonly create: ReturnType<typeof vi.fn>;
  readonly clone: ReturnType<typeof vi.fn>;
  readonly remove: ReturnType<typeof vi.fn>;
  readonly visible: ReturnType<typeof vi.fn>;
}

function planFakes(): PlanFakes {
  return {
    create: vi.fn(async () => "created"),
    clone: vi.fn(async () => "copy"),
    remove: vi.fn(async () => undefined),
    visible: vi.fn(async () => []),
  };
}

function servicesWith(fakes: PlanFakes): ReturnType<typeof servicesOf> {
  return servicesOf({
    agentPlanManagement: {
      create: fakes.create,
      clone: fakes.clone,
      remove: fakes.remove,
    },
    agentPlanService: { visible: fakes.visible },
  });
}

const CREATE: FormFields = {
  name: " New plan ",
  workspaceId: "workspace",
  requestKey: "dialog-1",
};

const CLONE: FormFields = {
  planId: "source",
  revision: "4",
  name: "Copy",
  workspaceId: "workspace",
  requestKey: "dialog-2",
};

async function planError(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error: unknown) {
    if (error instanceof AgentError) return error.code;
    throw error;
  }
  throw new Error("Expected an agent error.");
}

it("creates a plan on the Pages host when no target is given", async () => {
  const fakes = planFakes();

  const outcome = await outcomeOf(
    await createPlanAction("owner", servicesWith(fakes), formOf(CREATE)),
  );

  expect(fakes.create).toHaveBeenCalledWith(
    "owner",
    { name: "New plan", workspaceId: "workspace", executionTarget: undefined },
    "page-dialog-1",
  );
  expect(outcome.status).toBe(200);
  expect(outcome.headers.get("Cache-Control")).toBe("no-store");
  expect(outcome.body).toEqual({
    ok: true,
    intent: "create-plan",
    planId: "created",
    revision: 1,
  });
});

it("creates a plan with a valid remote target", async () => {
  const fakes = planFakes();
  const target = { kind: "remote", workspaceId: "remote-1" };

  await createPlanAction(
    "owner",
    servicesWith(fakes),
    formOf({ ...CREATE, target: JSON.stringify(target) }),
  );

  expect(fakes.create).toHaveBeenCalledWith(
    "owner",
    expect.objectContaining({ executionTarget: target }),
    "page-dialog-1",
  );
});

it("refuses an unreadable or unknown target before creating anything", async () => {
  const fakes = planFakes();
  const services = servicesWith(fakes);

  await expect(
    planError(
      createPlanAction("owner", services, formOf({ ...CREATE, target: "{" })),
    ),
  ).resolves.toBe("plan_invalid");
  await expect(
    planError(
      createPlanAction(
        "owner",
        services,
        formOf({ ...CREATE, target: '{"kind":"cloud"}' }),
      ),
    ),
  ).resolves.toBe("plan_invalid");
  expect(fakes.create).not.toHaveBeenCalled();
});

it("copies the named revision to the Pages host by default", async () => {
  const fakes = planFakes();

  const outcome = await outcomeOf(
    await clonePlanAction("copier", servicesWith(fakes), formOf(CLONE)),
  );

  expect(fakes.clone).toHaveBeenCalledWith(
    "copier",
    "source",
    {
      expectedRevision: 4,
      name: "Copy",
      workspaceId: "workspace",
      executionTarget: { kind: "local" },
    },
    "page-dialog-2",
  );
  expect(outcome.body).toEqual({
    ok: true,
    intent: "clone-plan",
    planId: "copy",
    revision: 1,
  });
});

it("copies a plan to the given target", async () => {
  const fakes = planFakes();
  const target = { kind: "remote", workspaceId: "remote-2" };

  await clonePlanAction(
    "copier",
    servicesWith(fakes),
    formOf({ ...CLONE, target: JSON.stringify(target) }),
  );

  expect(fakes.clone).toHaveBeenCalledWith(
    "copier",
    "source",
    expect.objectContaining({ executionTarget: target }),
    "page-dialog-2",
  );
});

it("refuses a copy of a missing or malformed revision", async () => {
  const fakes = planFakes();
  const services = servicesWith(fakes);

  for (const revision of ["0", "1.5", "abc"]) {
    await expect(
      planError(
        clonePlanAction("copier", services, formOf({ ...CLONE, revision })),
      ),
    ).resolves.toBe("plan_invalid");
  }
  expect(fakes.clone).not.toHaveBeenCalled();
});

function deletion(fields: FormFields): {
  readonly request: Request;
  readonly formData: FormData;
} {
  return {
    request: new Request("http://pages.invalid/agents/plans", {
      method: "POST",
    }),
    formData: formOf(fields),
  };
}

const DELETE: FormFields = {
  planId: "gone",
  revision: "2",
  requestKey: "dialog-3",
};

it("opens a remaining plan of the same project after a deletion", async () => {
  const fakes = planFakes();
  fakes.visible
    .mockResolvedValueOnce([
      { id: "other", projectId: "p2" },
      { id: "gone", projectId: "p1" },
    ])
    .mockResolvedValueOnce([
      { id: "other", projectId: "p2" },
      { id: "same project", projectId: "p1" },
    ]);

  const outcome = await outcomeOf(
    await deletePlanAction("owner", servicesWith(fakes), deletion(DELETE)),
  );

  expect(fakes.remove).toHaveBeenCalledWith("owner", "gone", {
    revision: 2,
    requestKey: "page-dialog-3",
  });
  expect(outcome.status).toBe(302);
  expect(outcome.location).toBe("/agents/plans?planId=same%20project");
  expect(outcome.headers.get("Cache-Control")).toBe("no-store");
});

it("opens the first readable plan when the deleted plan was already gone", async () => {
  const fakes = planFakes();
  fakes.visible
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: "first", projectId: "p3" }]);

  const outcome = await outcomeOf(
    await deletePlanAction("owner", servicesWith(fakes), deletion(DELETE)),
  );

  expect(outcome.location).toBe("/agents/plans?planId=first");
});

it("clears the selection when no readable plan remains", async () => {
  const fakes = planFakes();

  const outcome = await outcomeOf(
    await deletePlanAction("owner", servicesWith(fakes), deletion(DELETE)),
  );

  expect(outcome.location).toBe("/agents/plans");
});
