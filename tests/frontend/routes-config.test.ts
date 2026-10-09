// @vitest-environment jsdom
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
        "projekte",
        "tasks",
        "wiki",
      ]),
    );
  });

  it("nests the wiki pages below the wiki layout", () => {
    const layout = routes.find((entry) => !entry.path && entry.children);
    const wiki = layout?.children?.find((child) => child.path === "wiki");
    const paths = (wiki?.children ?? []).map((child) => child.path);

    expect(paths).toEqual([undefined, "trash", ":pageId/:slug?"]);
  });

  it("exposes a project detail route", () => {
    const layout = routes.find((entry) => !entry.path && entry.children);
    const childPaths = (layout?.children ?? []).map((child) => child.path);

    expect(childPaths).toContain("projekte/:projectId");
    expect(childPaths).toContain("projekte/:projectId/icon");
  });

  it("protects agent settings and the login resource under the authenticated layout", () => {
    const layout = routes.find((entry) => !entry.path && entry.children);
    const settings = layout?.children?.find(
      (entry) => entry.path === "settings",
    );
    expect(settings?.children?.map((entry) => entry.path)).toContain("agents");
    expect(layout?.children?.map((entry) => entry.path)).toContain(
      "settings-api/agents/:connectionId/login",
    );
  });

  it("exposes addressable ticket detail routes", () => {
    const layout = routes.find((entry) => !entry.path && entry.children);
    const childPaths = (layout?.children ?? []).map((child) => child.path);

    expect(childPaths).toContain("aufgaben/:ticketKey");
    expect(childPaths).toContain("tasks/:ticketKey");
  });
});
