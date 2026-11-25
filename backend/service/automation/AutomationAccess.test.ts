import { describe, expect, it, vi } from "vitest";

import { AutomationError } from "@/backend/error/AutomationError";

import { AutomationAccess } from "./AutomationAccess";

import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type { AutomationDefinition } from "./AutomationAccess";
import type {
  AutomationAccount,
  AutomationDirectory,
} from "./AutomationDirectory";

function accountOf(
  id: string,
  overrides: Partial<AutomationAccount> = {},
): AutomationAccount {
  return {
    id,
    displayName: id,
    isAgent: false,
    isActive: true,
    isAdministrator: false,
    isReadOnly: false,
    timeZone: "UTC",
    language: "en",
    ...overrides,
  };
}

function directoryOf(
  overrides: Partial<AutomationDirectory> = {},
): AutomationDirectory {
  return {
    account: vi.fn(async () => null),
    agents: vi.fn(async () => [{ id: "agent-1", name: "A", position: null }]),
    plans: vi.fn(async () => [
      { id: "plan-1", name: "P", projectName: null, canStart: true },
      { id: "plan-2", name: "Q", projectName: null, canStart: false },
    ]),
    planSteps: vi.fn(async () => [{ id: "step-1", name: "S" }]),
    projects: vi.fn(async () => [
      { id: "proj-1", name: "J", statuses: [{ id: "st-1", name: "Open" }] },
    ]),
    memberProjects: vi.fn(async () => []),
    groups: vi.fn(async () => []),
    isProjectMember: vi.fn(async () => false),
    isProjectManager: vi.fn(async () => false),
    isGroupMember: vi.fn(async () => false),
    workspaces: vi.fn(async () => [{ id: "ws-1", name: "W" }]),
    interpreterProfiles: vi.fn(async () => [{ id: "ip-1", name: "I" }]),
    sharingNames: vi.fn(async () => new Map()),
    ...overrides,
  };
}

function storedOf(overrides: Partial<StoredAutomation> = {}): StoredAutomation {
  return {
    id: "a1",
    creatorId: "creator",
    name: "N",
    trigger: { type: "manual" },
    action: { type: "agent", agentId: "agent-1", instruction: "go" },
    sharing: { scope: "private" },
    isActive: true,
    deleteAfterSuccess: false,
    agentNotification: { mode: "off" },
    nextRunAt: null,
    revision: 1,
    createdAt: "2030-01-01T00:00:00Z",
    updatedAt: "2030-01-01T00:00:00Z",
    ...overrides,
  };
}

const NONE = {
  trigger: false,
  action: false,
  sharing: false,
  agentNotification: false,
};

function definitionOf(
  overrides: Partial<AutomationDefinition> = {},
): AutomationDefinition {
  const { creatorId, name, ...rest } = storedOf();
  void creatorId;
  void name;
  return { ...rest, ...overrides };
}

async function reasonOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof AutomationError) return error.reason ?? error.code;
    throw error;
  }
  return null;
}

const scriptAction = {
  type: "script",
  workspaceId: "ws-1",
  interpreterProfileId: "ip-1",
  content: "echo",
  timeoutSeconds: 10,
} as const;

describe("AutomationAccess accounts", () => {
  it("resolves an active actor", async () => {
    const found = accountOf("u1");
    const access = new AutomationAccess(
      directoryOf({ account: vi.fn(async () => found) }),
    );
    expect(await access.actor("u1")).toBe(found);
    expect(await access.account("u1")).toBe(found);
  });

  it("refuses a missing or inactive actor", async () => {
    const missing = new AutomationAccess(directoryOf());
    expect(await reasonOf(missing.actor("u1"))).toBe("forbidden");
    const inactive = new AutomationAccess(
      directoryOf({
        account: vi.fn(async () => accountOf("u1", { isActive: false })),
      }),
    );
    expect(await reasonOf(inactive.actor("u1"))).toBe("forbidden");
    expect(await missing.account("u1")).toBeNull();
  });
});

describe("AutomationAccess.permissions", () => {
  const full = {
    canRead: true,
    canEdit: true,
    canRun: true,
    canDelete: true,
  };
  const readOnly = { ...full, canEdit: false, canRun: false, canDelete: false };
  const nothing = {
    canRead: false,
    canEdit: false,
    canRun: false,
    canDelete: false,
  };

  it("lets administrators and creators manage", async () => {
    const access = new AutomationAccess(directoryOf());
    const automation = storedOf();
    expect(
      await access.permissions(
        automation,
        accountOf("x", { isAdministrator: true }),
      ),
    ).toEqual(full);
    expect(await access.permissions(automation, accountOf("creator"))).toEqual(
      full,
    );
  });

  it("hides a private automation from others", async () => {
    const access = new AutomationAccess(directoryOf());
    expect(await access.permissions(storedOf(), accountOf("x"))).toEqual(
      nothing,
    );
  });

  it("shows a project share to members and lets managers manage", async () => {
    const sharing = { scope: "project", projectId: "proj-1" } as const;
    const member = new AutomationAccess(
      directoryOf({ isProjectMember: vi.fn(async () => true) }),
    );
    expect(
      await member.permissions(storedOf({ sharing }), accountOf("x")),
    ).toEqual(readOnly);
    const manager = new AutomationAccess(
      directoryOf({
        isProjectMember: vi.fn(async () => true),
        isProjectManager: vi.fn(async () => true),
      }),
    );
    expect(
      await manager.permissions(storedOf({ sharing }), accountOf("x")),
    ).toEqual(full);
    const stranger = new AutomationAccess(directoryOf());
    expect(
      await stranger.permissions(storedOf({ sharing }), accountOf("x")),
    ).toEqual(nothing);
  });

  it("shows a group share to members without management", async () => {
    const sharing = { scope: "group", groupId: "g1" } as const;
    const member = new AutomationAccess(
      directoryOf({ isGroupMember: vi.fn(async () => true) }),
    );
    for (const viewerId of ["x", "y", "z", "w"])
      expect(
        await member.permissions(storedOf({ sharing }), accountOf(viewerId)),
      ).toEqual(readOnly);
    const stranger = new AutomationAccess(directoryOf());
    expect(
      await stranger.permissions(storedOf({ sharing }), accountOf("x")),
    ).toEqual(nothing);
  });

  it("denies management to inactive and read-only accounts", async () => {
    const access = new AutomationAccess(directoryOf());
    const automation = storedOf();
    expect(
      await access.permissions(
        automation,
        accountOf("creator", { isReadOnly: true }),
      ),
    ).toEqual(readOnly);
    expect(
      await access.permissions(
        automation,
        accountOf("creator", { isActive: false }),
      ),
    ).toEqual(readOnly);
  });
});

describe("AutomationAccess.canSeeScript", () => {
  const access = new AutomationAccess(directoryOf());
  const edit = { canRead: true, canEdit: true, canRun: true, canDelete: true };

  it("needs edit rights and creator or administrator", () => {
    const automation = storedOf();
    expect(access.canSeeScript(automation, accountOf("creator"), edit)).toBe(
      true,
    );
    expect(
      access.canSeeScript(
        automation,
        accountOf("x", { isAdministrator: true }),
        edit,
      ),
    ).toBe(true);
    expect(access.canSeeScript(automation, accountOf("x"), edit)).toBe(false);
    expect(
      access.canSeeScript(automation, accountOf("creator"), {
        ...edit,
        canEdit: false,
      }),
    ).toBe(false);
  });
});

describe("AutomationAccess.checkDefinition", () => {
  const creator = accountOf("creator");
  const admin = accountOf("admin", { isAdministrator: true });

  it("accepts an unchanged definition", async () => {
    const access = new AutomationAccess(directoryOf());
    expect(
      await reasonOf(
        access.checkDefinition(
          definitionOf(),
          { creator, editor: creator },
          NONE,
        ),
      ),
    ).toBeNull();
  });

  it("refuses self-deleting definitions that are not once triggers", async () => {
    const access = new AutomationAccess(directoryOf());
    const parties = { creator, editor: creator };
    expect(
      await reasonOf(
        access.checkDefinition(
          definitionOf({ deleteAfterSuccess: true }),
          parties,
          NONE,
        ),
      ),
    ).toBe("delete_after_success_invalid");
    expect(
      await reasonOf(
        access.checkDefinition(
          definitionOf({
            deleteAfterSuccess: true,
            trigger: { type: "once", at: null, timeZone: "UTC" },
          }),
          parties,
          NONE,
        ),
      ),
    ).toBeNull();
  });

  it("checks agent actions for creator and editor", async () => {
    const access = new AutomationAccess(directoryOf());
    const changed = { ...NONE, action: true };
    expect(
      await reasonOf(
        access.checkDefinition(
          definitionOf(),
          { creator, editor: admin },
          changed,
        ),
      ),
    ).toBeNull();
    expect(
      await reasonOf(
        access.checkDefinition(
          definitionOf({
            action: { type: "agent", agentId: "nope", instruction: "x" },
          }),
          { creator, editor: creator },
          changed,
        ),
      ),
    ).toBe("agent_unavailable");
  });
});

describe("AutomationAccess.checkDefinition actions", () => {
  const creator = accountOf("creator");
  const admin = accountOf("admin", { isAdministrator: true });

  it("checks plan actions", async () => {
    const access = new AutomationAccess(directoryOf());
    const changed = { ...NONE, action: true };
    const parties = { creator, editor: creator };
    const planAction = (planId: string): AutomationDefinition =>
      definitionOf({ action: { type: "plan", planId } });
    expect(
      await reasonOf(
        access.checkDefinition(planAction("plan-1"), parties, changed),
      ),
    ).toBeNull();
    for (const id of ["plan-2", "missing"])
      expect(
        await reasonOf(
          access.checkDefinition(planAction(id), parties, changed),
        ),
      ).toBe("plan_unavailable");
  });

  it("checks script actions", async () => {
    const access = new AutomationAccess(directoryOf());
    const changed = { ...NONE, action: true };
    const parties = { creator: admin, editor: admin };
    const check = (
      action: AutomationDefinition["action"],
    ): Promise<string | null> =>
      reasonOf(
        access.checkDefinition(definitionOf({ action }), parties, changed),
      );
    expect(await check(scriptAction)).toBeNull();
    expect(
      await reasonOf(
        access.checkDefinition(
          definitionOf({ action: scriptAction }),
          { creator, editor: creator },
          changed,
        ),
      ),
    ).toBe("script_forbidden");
    expect(await check({ ...scriptAction, content: null })).toBe("validation");
    expect(await check({ ...scriptAction, workspaceId: "x" })).toBe(
      "workspace_unavailable",
    );
    expect(await check({ ...scriptAction, interpreterProfileId: "x" })).toBe(
      "interpreter_unavailable",
    );
    expect(
      await check({
        ...scriptAction,
        forward: { agentId: "agent-1", when: "always" },
      }),
    ).toBeNull();
    expect(
      await check({
        ...scriptAction,
        forward: { agentId: "nope", when: "always" },
      }),
    ).toBe("agent_unavailable");
  });
});

describe("AutomationAccess.checkDefinition triggers and shares", () => {
  const creator = accountOf("creator");

  it("checks event triggers", async () => {
    const access = new AutomationAccess(directoryOf());
    const changed = { ...NONE, trigger: true };
    const parties = { creator, editor: creator };
    const check = (
      trigger: AutomationDefinition["trigger"],
    ): Promise<string | null> =>
      reasonOf(
        access.checkDefinition(definitionOf({ trigger }), parties, changed),
      );
    const event = { type: "event", eventType: "plan.started" } as const;
    expect(await check({ type: "manual" })).toBeNull();
    expect(await check(event)).toBeNull();
    expect(await check({ ...event, planId: "p", stepId: "step-1" })).toBeNull();
    expect(await check({ ...event, planId: "p" })).toBeNull();
    expect(await check({ ...event, planId: "p", stepId: "bad" })).toBe(
      "event_filter_invalid",
    );
    expect(
      await check({ ...event, projectId: "proj-1", statusId: "st-1" }),
    ).toBeNull();
    expect(await check({ ...event, projectId: "proj-1" })).toBeNull();
    expect(await check({ ...event, projectId: "proj-1", statusId: "x" })).toBe(
      "event_filter_invalid",
    );
    expect(await check({ ...event, projectId: "other" })).toBe(
      "event_filter_invalid",
    );
    const hidden = new AutomationAccess(
      directoryOf({ planSteps: vi.fn(async () => null) }),
    );
    expect(
      await reasonOf(
        hidden.checkDefinition(
          definitionOf({ trigger: { ...event, planId: "p" } }),
          parties,
          changed,
        ),
      ),
    ).toBe("event_filter_invalid");
  });

  it("checks sharing targets", async () => {
    const changed = { ...NONE, sharing: true };
    const parties = { creator, editor: creator };
    const check = (
      access: AutomationAccess,
      sharing: AutomationDefinition["sharing"],
    ): Promise<string | null> =>
      reasonOf(
        access.checkDefinition(definitionOf({ sharing }), parties, changed),
      );
    const projectShare = { scope: "project", projectId: "proj-1" } as const;
    const groupShare = { scope: "group", groupId: "g1" } as const;
    const open = new AutomationAccess(
      directoryOf({
        isProjectMember: vi.fn(async () => true),
        isGroupMember: vi.fn(async () => true),
      }),
    );
    const closed = new AutomationAccess(directoryOf());
    expect(await check(open, { scope: "private" })).toBeNull();
    expect(await check(open, projectShare)).toBeNull();
    expect(await check(open, groupShare)).toBeNull();
    expect(await check(closed, { scope: "private" })).toBeNull();
    expect(await check(closed, projectShare)).toBe("sharing_target_invalid");
    expect(await check(closed, groupShare)).toBe("sharing_target_invalid");
  });
});

describe("AutomationAccess.checkDefinition notifications", () => {
  const creator = accountOf("creator");
  const admin = accountOf("admin", { isAdministrator: true });

  it("checks notification agents", async () => {
    const access = new AutomationAccess(directoryOf());
    const changed = { ...NONE, agentNotification: true };
    const parties = { creator, editor: admin };
    const check = (
      agentNotification: AutomationDefinition["agentNotification"],
    ): Promise<string | null> =>
      reasonOf(
        access.checkDefinition(
          definitionOf({ agentNotification }),
          parties,
          changed,
        ),
      );
    expect(await check({ mode: "off" })).toBeNull();
    expect(await check({ mode: "always", agentId: "agent-1" })).toBeNull();
    expect(await check({ mode: "always", agentId: null })).toBe(
      "agent_unavailable",
    );
    expect(await check({ mode: "always" })).toBe("agent_unavailable");
  });
});

describe("AutomationAccess run and visibility helpers", () => {
  it("blocks a run of an inactive or missing creator", async () => {
    const missing = new AutomationAccess(directoryOf());
    expect(await missing.runBlocker(storedOf())).toBe("creator_inactive");
    const inactive = new AutomationAccess(
      directoryOf({
        account: vi.fn(async () => accountOf("creator", { isActive: false })),
      }),
    );
    expect(await inactive.runBlocker(storedOf())).toBe("creator_inactive");
  });

  it("lets a run start or names the reason", async () => {
    const account = vi.fn(async () => accountOf("creator"));
    const access = new AutomationAccess(directoryOf({ account }));
    expect(await access.runBlocker(storedOf())).toBeNull();
    expect(
      await access.runBlocker(
        storedOf({ action: { type: "plan", planId: "plan-2" } }),
      ),
    ).toBe("plan_unavailable");
    expect(
      await access.runBlocker(storedOf({ action: { ...scriptAction } })),
    ).toBe("script_forbidden");
  });

  it("accepts stored script content on a run", async () => {
    const access = new AutomationAccess(
      directoryOf({
        account: vi.fn(async () =>
          accountOf("creator", { isAdministrator: true }),
        ),
      }),
    );
    expect(
      await access.runBlocker(
        storedOf({ action: { ...scriptAction, content: null } }),
      ),
    ).toBeNull();
  });

  it("rethrows unexpected errors of a run check", async () => {
    const failure = new Error("boom");
    const access = new AutomationAccess(
      directoryOf({
        account: vi.fn(async () => accountOf("creator")),
        agents: vi.fn(async () => {
          throw failure;
        }),
      }),
    );
    await expect(access.runBlocker(storedOf())).rejects.toBe(failure);
  });

  it("rethrows an automation error without a reason", async () => {
    const failure = new AutomationError("forbidden");
    const access = new AutomationAccess(
      directoryOf({
        account: vi.fn(async () => accountOf("creator")),
        agents: vi.fn(async () => {
          throw failure;
        }),
      }),
    );
    await expect(access.runBlocker(storedOf())).rejects.toBe(failure);
  });

  it("lets only active accounts use listed agents", async () => {
    const access = new AutomationAccess(directoryOf());
    expect(await access.canUseAgent("agent-1", accountOf("u"))).toBe(true);
    expect(await access.canUseAgent("nope", accountOf("u"))).toBe(false);
    expect(
      await access.canUseAgent("agent-1", accountOf("u", { isActive: false })),
    ).toBe(false);
  });

  it("answers plan and project visibility", async () => {
    const access = new AutomationAccess(directoryOf());
    expect(await access.canSeePlan("plan-1", "u")).toBe(true);
    expect(await access.canSeePlan("nope", "u")).toBe(false);
    expect(await access.canSeeProject("proj-1", "u")).toBe(true);
    expect(await access.canSeeProject("nope", "u")).toBe(false);
  });
});
