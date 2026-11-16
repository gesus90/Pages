import { expect, it, vi } from "vitest";

import { AutomationAccess } from "@/backend/service/automation/AutomationAccess";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type {
  AutomationAccount,
  AutomationDirectory,
} from "@/backend/service/automation/AutomationDirectory";
import type { AutomationDefinition } from "@/backend/service/automation/AutomationAccess";

const CREATOR: AutomationAccount = {
  id: "creator",
  displayName: "Creator",
  isAgent: false,
  isActive: true,
  isAdministrator: false,
  isReadOnly: false,
  timeZone: "UTC",
  language: "en",
};
const AUTOMATION = partial<StoredAutomation>({
  creatorId: CREATOR.id,
  sharing: { scope: "project", projectId: "project" },
  action: { type: "plan", planId: "plan" },
});
const DEFINITION: AutomationDefinition = {
  trigger: { type: "manual" },
  action: { type: "agent", agentId: "agent", instruction: "Work" },
  sharing: { scope: "private" },
  agentNotification: { mode: "off" },
  deleteAfterSuccess: false,
};
const CHANGED = {
  trigger: true,
  action: true,
  sharing: true,
  agentNotification: true,
};

const directoryMocks = {
  account: vi.fn(async () => CREATOR),
  agents: vi.fn(async () => [{ id: "agent", name: "Agent", position: null }]),
  plans: vi.fn(async () => [
    { id: "plan", name: "Plan", projectName: null, canStart: true },
  ]),
  planSteps: vi.fn(async () => [{ id: "step", name: "Step" }]),
  projects: vi.fn(async () => [
    {
      id: "project",
      name: "Project",
      statuses: [{ id: "status", name: "Status" }],
    },
  ]),
  isProjectMember: vi.fn(async () => true),
  isProjectManager: vi.fn(async () => false),
  isGroupMember: vi.fn(async () => false),
  workspaces: vi.fn(async () => [{ id: "workspace", name: "Workspace" }]),
  interpreterProfiles: vi.fn(async () => [{ id: "profile", name: "Profile" }]),
};

function fixture(): {
  directory: typeof directoryMocks;
  access: AutomationAccess;
} {
  vi.resetAllMocks();
  return {
    directory: directoryMocks,
    access: new AutomationAccess(partial<AutomationDirectory>(directoryMocks)),
  };
}

it("grants management to the creator, administrators and project managers only", async () => {
  const { access, directory } = fixture();
  const viewer = { ...CREATOR, id: "viewer" };
  await expect(access.permissions(AUTOMATION, CREATOR)).resolves.toMatchObject({
    canRead: true,
    canEdit: true,
  });
  const readOnly = await access.permissions(AUTOMATION, viewer);
  expect(readOnly).toEqual({
    canRead: true,
    canEdit: false,
    canRun: false,
    canDelete: false,
  });
  expect(access.canSeeScript(AUTOMATION, viewer, readOnly)).toBe(false);
  directory.isProjectManager.mockResolvedValue(true);
  const manager = await access.permissions(AUTOMATION, viewer);
  expect(manager.canEdit).toBe(true);
  expect(access.canSeeScript(AUTOMATION, viewer, manager)).toBe(false);
  const admin = { ...viewer, isAdministrator: true };
  expect(
    access.canSeeScript(
      AUTOMATION,
      admin,
      await access.permissions(AUTOMATION, admin),
    ),
  ).toBe(true);
  expect(
    (await access.permissions(AUTOMATION, { ...admin, isReadOnly: true }))
      .canEdit,
  ).toBe(false);
  directory.isProjectMember.mockResolvedValue(false);
  expect((await access.permissions(AUTOMATION, viewer)).canRead).toBe(false);
});

it("checks both creator and editor when saving actions and notifications", async () => {
  const { access } = fixture();
  const parties = { creator: CREATOR, editor: { ...CREATOR, id: "editor" } };
  await expect(
    access.checkDefinition(DEFINITION, parties, CHANGED),
  ).resolves.toBeUndefined();
  await expect(
    access.checkDefinition(
      {
        ...DEFINITION,
        agentNotification: { mode: "always", agentId: "missing" },
      },
      parties,
      CHANGED,
    ),
  ).rejects.toMatchObject({ reason: "agent_unavailable" });
  await expect(
    access.checkDefinition(
      { ...DEFINITION, deleteAfterSuccess: true },
      parties,
      CHANGED,
    ),
  ).rejects.toMatchObject({ reason: "delete_after_success_invalid" });
  await expect(
    access.checkDefinition(
      { ...DEFINITION, action: { type: "plan", planId: "missing" } },
      parties,
      CHANGED,
    ),
  ).rejects.toMatchObject({ reason: "plan_unavailable" });
});

it("validates event filters and sharing against the creator's current access", async () => {
  const { access } = fixture();
  const parties = { creator: CREATOR, editor: CREATOR };
  const definition = {
    ...DEFINITION,
    trigger: {
      type: "event",
      eventType: "plan.step_changed",
      planId: "plan",
      stepId: "step",
      projectId: "project",
      statusId: "status",
    },
    sharing: { scope: "project", projectId: "project" },
  } satisfies AutomationDefinition;
  await expect(
    access.checkDefinition(definition, parties, CHANGED),
  ).resolves.toBeUndefined();
  await expect(
    access.checkDefinition(
      { ...definition, trigger: { ...definition.trigger, stepId: "missing" } },
      parties,
      CHANGED,
    ),
  ).rejects.toMatchObject({ reason: "event_filter_invalid" });
  await expect(
    access.checkDefinition(
      { ...definition, sharing: { scope: "group", groupId: "group" } },
      parties,
      CHANGED,
    ),
  ).rejects.toMatchObject({ reason: "sharing_target_invalid" });
});

it("rechecks plan and script permissions when a stored automation runs", async () => {
  const { access, directory } = fixture();
  await expect(access.runBlocker(AUTOMATION)).resolves.toBeNull();
  directory.plans.mockResolvedValue([]);
  await expect(access.runBlocker(AUTOMATION)).resolves.toBe("plan_unavailable");
  const script = {
    ...AUTOMATION,
    action: {
      type: "script" as const,
      content: null,
      workspaceId: "workspace",
      interpreterProfileId: "profile",
      timeoutSeconds: 10,
    },
  };
  await expect(access.runBlocker(script)).resolves.toBe("script_forbidden");
  directory.account.mockResolvedValue({ ...CREATOR, isAdministrator: true });
  await expect(access.runBlocker(script)).resolves.toBeNull();
  directory.workspaces.mockResolvedValue([]);
  await expect(access.runBlocker(script)).resolves.toBe(
    "workspace_unavailable",
  );
});
