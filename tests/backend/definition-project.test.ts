import { describe, expect, it } from "vitest";

import {
  isProjectStatus,
  PROJECT_STATUS,
  publishesNewTasks,
} from "@/definition/Project";

import type { ProjectIntegration } from "@/definition/Project";

describe("project definitions", () => {
  it("exposes every supported project status", () => {
    expect(PROJECT_STATUS).toEqual({
      ACTIVE: "active",
      COMPLETED: "completed",
      PAUSED: "paused",
      PLANNED: "planned",
    });
  });
});

describe("isProjectStatus", () => {
  it.each(Object.values(PROJECT_STATUS))("accepts %s", (status) => {
    expect(isProjectStatus(status)).toBe(true);
  });

  it.each(["archived", "", "ACTIVE", null, undefined, 0, true, {}, []])(
    "rejects unsupported value %p",
    (value) => {
      expect(isProjectStatus(value)).toBe(false);
    },
  );
});

describe("publishesNewTasks", () => {
  const active: ProjectIntegration = {
    hasToken: true,
    isConnected: false,
    lastSyncAt: null,
    nextSyncAt: null,
    projectId: "project-1",
    repoName: null,
    repoUrl: "https://github.com/example/repo",
    syncComments: true,
    syncCommits: true,
    syncDirection: "bidirectional",
    syncEnabled: true,
    syncIntervalMinutes: 5,
    syncIssues: true,
    syncPullRequests: true,
    syncStatus: true,
    updatedAt: "2026-10-07",
  };

  it("is true for a stored repository and token with synchronization on", () => {
    expect(publishesNewTasks(active)).toBe(true);
    expect(publishesNewTasks({ ...active, syncDirection: "push" })).toBe(true);
  });

  it.each([
    ["no integration", null],
    ["no repository", { ...active, repoUrl: "" }],
    ["no token", { ...active, hasToken: false }],
    ["synchronization switched off", { ...active, syncEnabled: false }],
    ["issues out of scope", { ...active, syncIssues: false }],
    ["a pull-only direction", { ...active, syncDirection: "pull" as const }],
  ])("is false for %s", (_label, integration) => {
    expect(publishesNewTasks(integration)).toBe(false);
  });
});
