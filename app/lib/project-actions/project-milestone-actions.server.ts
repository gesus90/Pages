import { readTextOrEmpty, readTrimmedText } from "@/app/lib/form-fields.server";
import {
  isMilestoneColor,
  isMilestoneIcon,
  isMilestoneLinkType,
} from "@/definition/Task";

import { invalidInput, succeeded } from "./project-action-support.server";
import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

import type {
  ProjectActionContext,
  ProjectActionHandler,
} from "./project-action-support.server";
import type {
  Milestone,
  MilestoneColor,
  MilestoneDependency,
  MilestoneIcon,
  MilestoneLinkType,
} from "@/definition/Task";

type MilestoneStatus = Milestone["status"];

interface MilestoneLinkChange {
  readonly targetId: string;
  readonly linkType: MilestoneLinkType;
}

interface MilestoneLinkChanges {
  readonly added: readonly MilestoneLinkChange[];
  readonly removedIds: readonly string[];
}

function isMilestoneStatus(value: string): value is MilestoneStatus {
  return value === "open" || value === "completed" || value === "archived";
}

function readMilestoneColor(formData: FormData): MilestoneColor | null {
  const value = readTextOrEmpty(formData, "colorKey").trim();

  return isMilestoneColor(value) ? value : null;
}

function readMilestoneIcon(formData: FormData): MilestoneIcon | null {
  const value = readTextOrEmpty(formData, "iconKey").trim();

  return isMilestoneIcon(value) ? value : null;
}

function isLinkChange(entry: unknown): entry is MilestoneLinkChange {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "targetId" in entry &&
    typeof entry.targetId === "string" &&
    "linkType" in entry &&
    isMilestoneLinkType(entry.linkType)
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseAddedLinks(text: string): MilestoneLinkChange[] | null {
  if (!text) {
    return [];
  }

  const parsed = parseJson(text);

  if (!Array.isArray(parsed) || !parsed.every(isLinkChange)) {
    return null;
  }

  return parsed.map((entry) => ({
    linkType: entry.linkType,
    targetId: entry.targetId,
  }));
}

function parseRemovedLinkIds(text: string): string[] | null {
  if (!text) {
    return [];
  }

  const parsed = parseJson(text);

  if (
    !Array.isArray(parsed) ||
    !parsed.every((entry) => typeof entry === "string")
  ) {
    return null;
  }

  return parsed;
}

/**
 * Reads the dependency changes submitted with a milestone.
 *
 * @param formData - Parsed request form data.
 * @returns The links to add and to remove, or `null` when the payload is
 * malformed.
 */
function readLinkChanges(formData: FormData): MilestoneLinkChanges | null {
  const added = parseAddedLinks(readTextOrEmpty(formData, "addLinks").trim());
  const removedIds = parseRemovedLinkIds(
    readTextOrEmpty(formData, "removeLinks").trim(),
  );

  return added && removedIds ? { added, removedIds } : null;
}

async function createMilestoneFromForm({
  actor,
  formData,
  projectId,
  services,
}: ProjectActionContext): Promise<void> {
  await services.taskService.createMilestone(actor, {
    colorCustom: readTrimmedText(formData, "customColor"),
    colorKey: readMilestoneColor(formData),
    description: readTextOrEmpty(formData, "description"),
    dueAt: readTrimmedText(formData, "dueAt"),
    iconKey: readMilestoneIcon(formData),
    name: readTextOrEmpty(formData, "name"),
    projectId,
    startAt: readTrimmedText(formData, "startAt"),
  });
}

/**
 * Removes the given dependencies, tolerating repeated submissions.
 *
 * @remarks
 * Link application stays idempotent: repeated submissions of the same
 * payload (for example rapid retries) converge on the stored state instead
 * of failing on unique constraints or missing rows.
 */
async function removeMilestoneLinks(
  { actor, projectId, services }: ProjectActionContext,
  removedIds: readonly string[],
): Promise<void> {
  const findLinks = (): Promise<readonly MilestoneDependency[]> =>
    services.taskService.findDependencies(actor, [projectId]);

  for (const removedId of removedIds) {
    if (!(await findLinks()).some((link) => link.id === removedId)) {
      continue;
    }

    try {
      await services.taskService.removeDependency(actor, projectId, removedId);
    } catch (error: unknown) {
      const isStillStored = async (): Promise<boolean> =>
        (await findLinks()).some((link) => link.id === removedId);

      if (
        !(error instanceof WorkItemValidationError) ||
        (await isStillStored())
      ) {
        throw error;
      }
    }
  }
}

/** Adds the given dependencies, tolerating repeated submissions. */
async function addMilestoneLinks(
  { actor, projectId, services }: ProjectActionContext,
  milestoneId: string,
  added: readonly MilestoneLinkChange[],
): Promise<void> {
  const findLinks = (): Promise<readonly MilestoneDependency[]> =>
    services.taskService.findDependencies(actor, [projectId]);

  for (const change of added) {
    const isStored = (link: MilestoneDependency): boolean =>
      link.sourceId === milestoneId &&
      link.targetId === change.targetId &&
      link.linkType === change.linkType;

    if ((await findLinks()).some(isStored)) {
      continue;
    }

    try {
      await services.taskService.addDependency(actor, {
        linkType: change.linkType,
        projectId,
        sourceId: milestoneId,
        targetId: change.targetId,
      });
    } catch (error: unknown) {
      if (
        !(error instanceof WorkItemValidationError) ||
        !(await findLinks()).some(isStored)
      ) {
        throw error;
      }
    }
  }
}

/** Creates a milestone. */
export const handleCreateMilestone: ProjectActionHandler = async (context) => {
  await createMilestoneFromForm(context);

  return succeeded();
};

/** Creates a milestone, or saves an existing one together with its links. */
export const handleSaveMilestone: ProjectActionHandler = async (context) => {
  const { actor, formData, projectId, services } = context;
  const milestoneId = readTextOrEmpty(formData, "milestoneId").trim();
  const status = readTextOrEmpty(formData, "status");

  if (!isMilestoneStatus(status)) {
    return invalidInput();
  }

  if (!milestoneId) {
    await createMilestoneFromForm(context);

    return succeeded();
  }

  const milestones = await services.taskService.findMilestones(actor, [
    projectId,
  ]);
  const milestone = milestones.find((entry) => entry.id === milestoneId);

  if (!milestone) {
    return invalidInput();
  }

  // Validate the dependency payload before the first mutation so a rejected
  // save never leaves a partially persisted milestone behind.
  const linkChanges = readLinkChanges(formData);

  if (!linkChanges) {
    return invalidInput();
  }

  await services.taskService.updateMilestone(actor, milestone.id, {
    colorCustom:
      readTrimmedText(formData, "customColor") ?? milestone.colorCustom ?? null,
    colorKey: readMilestoneColor(formData) ?? milestone.colorKey ?? null,
    description: readTextOrEmpty(formData, "description"),
    dueAt: readTrimmedText(formData, "dueAt"),
    iconKey: readMilestoneIcon(formData) ?? milestone.iconKey ?? null,
    name: readTextOrEmpty(formData, "name"),
    startAt: readTrimmedText(formData, "startAt") ?? milestone.startAt,
    status,
  });
  await removeMilestoneLinks(context, linkChanges.removedIds);
  await addMilestoneLinks(context, milestone.id, linkChanges.added);

  return succeeded();
};

/** Deletes a milestone. */
export const handleDeleteMilestone: ProjectActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const milestoneId = readTextOrEmpty(formData, "milestoneId").trim();

  if (!milestoneId) {
    return invalidInput();
  }

  await services.taskService.deleteMilestone(actor, milestoneId);

  return succeeded();
};

/** Changes only the status of a milestone. */
export const handleUpdateMilestoneStatus: ProjectActionHandler = async ({
  actor,
  formData,
  projectId,
  services,
}) => {
  const milestones = await services.taskService.findMilestones(actor, [
    projectId,
  ]);
  const milestone = milestones.find(
    (entry) => entry.id === readTextOrEmpty(formData, "milestoneId"),
  );
  const status = readTextOrEmpty(formData, "status");

  if (!milestone || !isMilestoneStatus(status)) {
    return invalidInput();
  }

  await services.taskService.updateMilestone(actor, milestone.id, {
    colorCustom: milestone.colorCustom ?? null,
    colorKey: milestone.colorKey ?? null,
    description: milestone.description,
    dueAt: milestone.dueAt,
    iconKey: milestone.iconKey ?? null,
    name: milestone.name,
    startAt: milestone.startAt,
    status,
  });

  return succeeded();
};
