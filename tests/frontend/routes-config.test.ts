// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import routes from "@/app/routes";

describe("A9.6 route configuration", () => {
  it("exposes binary agent uploads publicly and protects stable asset downloads with the authenticated layout", () => {
    const layout = routes.find((entry) => !entry.path && entry.children);
    expect(
      routes.find((entry) => entry.path === "api/v1/agent-assets"),
    ).toMatchObject({
      file: "routes/api-v1-agent-assets.ts",
    });
    expect(
      layout?.children?.find((entry) => entry.path === "agent-assets/:assetId"),
    ).toMatchObject({
      file: "routes/agent-asset.ts",
    });
    expect(routes.some((entry) => entry.path === "agent-assets/:assetId")).toBe(
      false,
    );
    expect(
      layout?.children?.some((entry) => entry.path === "api/v1/agent-assets"),
    ).toBe(false);
  });
});

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
      expect.arrayContaining(["dashboard", "settings", "projekte", "wiki"]),
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

  it("exposes the ticket pages below the ticket layout with its tree", () => {
    const layout = routes.find((entry) => !entry.path && entry.children);
    const tickets = layout?.children?.find(
      (child) => child.file === "routes/tasks-layout.tsx",
    );

    expect(tickets?.path).toBeUndefined();
    expect(tickets?.children?.map((child) => child.path)).toEqual([
      "aufgaben",
      "tasks",
      "aufgaben/:ticketKey",
      "tasks/:ticketKey",
    ]);
    expect(layout?.children?.map((child) => child.path)).toEqual(
      expect.arrayContaining([
        "aufgaben-api/attachments",
        "aufgaben/attachments/:attachmentId",
      ]),
    );
  });
});
