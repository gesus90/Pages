import { describe, expect, it } from "vitest";

import routes from "@/app/routes";

describe("route configuration", () => {
  it("exposes the public login and logout routes", () => {
    const paths = routes
      .map((entry) => entry.path)
      .filter((path): path is string => typeof path === "string");

    expect(paths).toContain("login");
    expect(paths).toContain("logout");
  });

  it("nests the workspace routes below the authenticated layout", () => {
    const layout = routes.find((entry) => !entry.path && entry.children);
    const childPaths = (layout?.children ?? [])
      .map((child) => child.path)
      .filter((path): path is string => typeof path === "string");

    expect(childPaths).toEqual(
      expect.arrayContaining([
        "dashboard",
        "settings",
        "projects",
        "tasks",
        "wiki",
      ]),
    );
  });

  it("exposes a project detail route", () => {
    const layout = routes.find((entry) => !entry.path && entry.children);
    const childPaths = (layout?.children ?? []).map((child) => child.path);

    expect(childPaths).toContain("projects/:projectId");
  });
});
