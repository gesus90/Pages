import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { PagesClient } from "./pages-client";

/** The agent plan of the Teams and owner tests (PAGE-329). */
export interface SeedPlan {
  readonly id: string;
  readonly name: string;
  /** The department the tests add as a team of the plan. */
  readonly teamName: string;
}

const workspaceAnswer = z.object({
  workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
});
const planAnswer = z.object({ ok: z.literal(true), planId: z.string() });

const WORKSPACE_NAME = "Plan workspace";
const PLAN_NAME = "Team plan";
const TEAM_NAME = "A-Team";

/** Posts a form and refuses every answer but 200. */
async function postOk(
  admin: PagesClient,
  path: string,
  fields: Readonly<Record<string, string>>,
): Promise<string> {
  const answer = await admin.postForm(path, fields);

  if (answer.status !== 200) {
    throw new Error(
      `${fields.intent ?? path} was refused with ${answer.status}: ${answer.text.slice(0, 300)}`,
    );
  }

  return answer.text;
}

/**
 * Registers the workspace directory for the project and returns its identifier.
 *
 * @remarks
 * A workspace needs a project linked to a GitHub repository. The link is a
 * synthetic address without a token and without synchronization, so nothing
 * ever reaches GitHub.
 */
async function registerWorkspace(
  admin: PagesClient,
  projectId: string,
  directory: string,
): Promise<string> {
  await postOk(admin, `/projekte/${encodeURIComponent(projectId)}`, {
    intent: "save-integration",
    repoUrl: "https://github.com/example/plans.git",
    syncDirection: "pull",
    syncIntervalMinutes: "0",
    token: "",
  });
  await postOk(admin, "/agents/workspaces", {
    intent: "save-workspace",
    workspace: JSON.stringify({
      name: WORKSPACE_NAME,
      path: directory,
      projectId,
    }),
  });
  const { workspaces } = await admin.getJson(
    `/agent-api/workspaces?projectId=${encodeURIComponent(projectId)}`,
    workspaceAnswer,
  );
  const workspace = workspaces.find((entry) => entry.name === WORKSPACE_NAME);

  if (!workspace) {
    throw new Error("The plan workspace was not registered.");
  }

  return workspace.id;
}

/**
 * Creates a department, a workspace and an empty plan the administrator owns.
 *
 * @param admin - The signed-in administrator.
 * @param projectId - An open project, created before any department existed.
 * @param directory - An empty directory the server may use as workspace.
 * @returns The plan and the name of the department.
 *
 * @remarks
 * The department has no members: the tests only add it as a team and read it
 * back. A group would need a member, which the seeding cannot name.
 * The plan has no steps, so nothing of it can run a model or a script.
 */
export async function seedPlan(
  admin: PagesClient,
  projectId: string,
  directory: string,
): Promise<SeedPlan> {
  const workspaceId = await registerWorkspace(admin, projectId, directory);
  const created = planAnswer.parse(
    JSON.parse(
      await postOk(admin, "/agents/plans", {
        intent: "create-plan",
        name: PLAN_NAME,
        requestKey: randomUUID(),
        workspaceId,
      }),
    ),
  );

  // Only now: a creator in exactly one department would give the new plan
  // that department as its first team, and the tests start without a team.
  await postOk(admin, "/users", {
    entityId: randomUUID(),
    intent: "save-department",
    name: TEAM_NAME,
  });

  return { teamName: TEAM_NAME, id: created.planId, name: PLAN_NAME };
}
