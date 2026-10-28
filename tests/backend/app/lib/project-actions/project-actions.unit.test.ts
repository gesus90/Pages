import { beforeEach, expect, it, vi } from "vitest";

import { handleProjectAction } from "@/app/lib/project-actions/project-actions.server";
import {
  handleAddMember,
  handleUpdateName,
} from "@/app/lib/project-actions/project-data-actions.server";
import { handleSyncIntegration } from "@/app/lib/project-actions/project-integration-actions.server";
import { handleArchiveMilestone } from "@/app/lib/project-actions/project-milestone-actions.server";

import { outcomeOf } from "../../actions/action-fixtures";
import { projectContext } from "./project-action-fixtures";

import type { Mock } from "vitest";

vi.mock("@/app/lib/project-actions/project-data-actions.server", () => ({
  handleAddMember: vi.fn(),
  handleArchiveEvent: vi.fn(),
  handleCreateEvent: vi.fn(),
  handleCreateGoal: vi.fn(),
  handleDeleteGoal: vi.fn(),
  handleRemoveMember: vi.fn(),
  handleSaveTemplate: vi.fn(),
  handleSetTags: vi.fn(),
  handleToggleGoal: vi.fn(),
  handleUpdateDates: vi.fn(),
  handleUpdateDescription: vi.fn(),
  handleUpdateDetails: vi.fn(),
  handleUpdateManager: vi.fn(),
  handleUpdateMemberRole: vi.fn(),
  handleUpdateName: vi.fn(),
  handleUpdateStatus: vi.fn(),
}));
vi.mock("@/app/lib/project-actions/project-integration-actions.server", () => ({
  handleDisconnectIntegration: vi.fn(),
  handleSaveIntegration: vi.fn(),
  handleSetIntegrationSync: vi.fn(),
  handleSyncIntegration: vi.fn(),
  handleTestIntegration: vi.fn(),
}));
vi.mock("@/app/lib/project-actions/project-milestone-actions.server", () => ({
  handleArchiveMilestone: vi.fn(),
  handleCreateMilestone: vi.fn(),
  handleSaveMilestone: vi.fn(),
  handleUpdateMilestoneStatus: vi.fn(),
}));

const HANDLED_RESPONSE = { data: { ok: true }, init: null };

beforeEach(() => {
  vi.resetAllMocks();
});

it.each<[string, Mock]>([
  ["add-member", vi.mocked(handleAddMember)],
  ["update-name", vi.mocked(handleUpdateName)],
  ["sync-integration", vi.mocked(handleSyncIntegration)],
  ["archive-milestone", vi.mocked(handleArchiveMilestone)],
])("hands the intent %s to its handler", async (intent, handler) => {
  const context = projectContext({});
  handler.mockResolvedValue(HANDLED_RESPONSE);

  const result = await handleProjectAction(intent, context);

  expect(result).toBe(HANDLED_RESPONSE);
  expect(handler).toHaveBeenCalledExactlyOnceWith(context);
});

it.each<[string, FormDataEntryValue | null]>([
  ["a missing intent", null],
  ["an unknown intent", "launch-rocket"],
  ["an inherited object member", "toString"],
  ["a file", new File(["add-member"], "intent.txt")],
])("refuses %s as invalid input", async (situation, intent) => {
  const result = await handleProjectAction(intent, projectContext({}));

  expect(await outcomeOf(result)).toMatchObject({
    body: { error: "invalidInput", ok: false },
    status: 400,
  });
  expect(handleAddMember).not.toHaveBeenCalled();
});
