import { describe, expect, it, vi } from "vitest";

import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import { PagesPicaMobileDashboard } from "@/backend/service/mobile/PicaMobileDashboardService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { PicaMobileDashboardServices } from "@/backend/service/mobile/PicaMobileDashboardService";
import type { PicaMobileSessionIdentity } from "@/backend/service/mobile/PicaMobileDashboardProvider";

const session = partial<PicaMobileSessionIdentity>({
  userId: "u",
  sessionToken: "token",
});

function fixture(): {
  dashboard: PagesPicaMobileDashboard;
  auth: ReturnType<typeof vi.fn>;
  runs: ReturnType<typeof vi.fn>;
  projects: ReturnType<typeof vi.fn>;
} {
  const auth = vi.fn().mockResolvedValue({
    id: "u",
    isActive: true,
    mustChangePassword: false,
    displayName: "Ada",
    avatarType: "none",
  });
  const runs = vi.fn().mockResolvedValue([]);
  const projects = vi.fn().mockResolvedValue([]);
  const services = partial<PicaMobileDashboardServices>({
    authService: { getAuthenticatedUser: auth },
    agentPlanActiveRunService: { list: runs },
    projectService: { findAssigned: projects },
    userService: partial({}),
  });
  return {
    dashboard: new PagesPicaMobileDashboard(async () => services),
    auth,
    runs,
    projects,
  };
}

describe("mobile dashboard sections", () => {
  it("returns assigned project progress and independently reports failed sections", async () => {
    const { dashboard, runs, projects } = fixture();
    runs.mockRejectedValueOnce(new ProjectAccessDeniedError());
    projects.mockResolvedValueOnce([
      {
        project: { id: "p", name: "Project", progress: 42 },
        goalCount: 2,
        completedGoalCount: 1,
      },
      {
        project: { id: "q", name: "Empty" },
        goalCount: 0,
        completedGoalCount: 0,
      },
    ]);
    await expect(dashboard.readDashboard(session)).resolves.toMatchObject({
      kind: "ready",
      dashboard: {
        profile: { displayName: "Ada", avatar: null },
        runs: { status: "forbidden" },
        projects: {
          status: "ready",
          items: [
            { id: "p", progress: { percent: 42, completed: 1, total: 2 } },
            { id: "q", progress: null },
          ],
        },
      },
    });
    projects.mockRejectedValueOnce(new Error("unavailable"));
    await expect(dashboard.readDashboard(session)).resolves.toMatchObject({
      dashboard: { runs: { status: "ready" }, projects: { status: "error" } },
    });
  });

  it("does not read data for an expired session and reports a missing avatar", async () => {
    const { dashboard, auth, runs } = fixture();
    auth.mockResolvedValueOnce(null);
    await expect(dashboard.readDashboard(session)).resolves.toEqual({
      kind: "sessionEnded",
    });
    expect(runs).not.toHaveBeenCalled();
    await expect(dashboard.readAvatar(session, "version")).resolves.toEqual({
      kind: "notFound",
    });
  });
});
