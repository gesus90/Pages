import { expect, it } from "vitest";

import { McpProjectRequest } from "@/backend/service/mcp/project/McpProjectRequest";
import { GITHUB_SYNC_INTERVAL } from "@/definition/Project";

it("validates the overview query and project fields", () => {
  expect(McpProjectRequest.overview(new URLSearchParams())).toEqual({
    isArchived: false,
  });
  expect(McpProjectRequest.overview(new URLSearchParams("archived=1"))).toEqual(
    { isArchived: true },
  );
  expect(() =>
    McpProjectRequest.overview(new URLSearchParams("archived=1&archived=1")),
  ).toThrow();
  expect(McpProjectRequest.create({ name: " Project " })).toEqual({
    name: "Project",
  });
  expect(
    McpProjectRequest.patch({ startDate: "2024-02-29", targetDate: null }),
  ).toEqual({ startDate: "2024-02-29", targetDate: null });
  expect(() => McpProjectRequest.patch({})).toThrow();
  expect(() => McpProjectRequest.patch({ startDate: "2023-02-29" })).toThrow();
  expect(() =>
    McpProjectRequest.create({ name: "Project", hidden: true }),
  ).toThrow();
});

it("validates members, goals, events and confirmation", () => {
  expect(McpProjectRequest.member({ role: "member" })).toEqual({
    role: "member",
  });
  expect(McpProjectRequest.goalCreate({ title: " Goal " })).toEqual({
    title: "Goal",
  });
  expect(McpProjectRequest.goalUpdate({ isDone: true })).toEqual({
    isDone: true,
  });
  expect(
    McpProjectRequest.eventCreate({
      title: "Event",
      date: "2024-02-29",
      time: "23:59",
    }),
  ).toMatchObject({ title: "Event" });
  expect(() =>
    McpProjectRequest.eventCreate({
      title: "Event",
      date: "2024-02-29",
      time: "24:00",
    }),
  ).toThrow();
  expect(McpProjectRequest.confirmation({ confirmed: true })).toEqual({
    confirmed: true,
  });
  expect(() => McpProjectRequest.confirmation({ confirmed: false })).toThrow();
  expect(() => McpProjectRequest.empty({ extra: true })).toThrow();
});

it("decodes only supported nonempty base64 icons", () => {
  expect(
    McpProjectRequest.icon({ mimeType: "image/png", dataBase64: "AQID" }),
  ).toEqual({ mimeType: "image/png", data: Buffer.from([1, 2, 3]) });
  for (const body of [
    { mimeType: "image/svg+xml", dataBase64: "AQID" },
    { mimeType: "image/png", dataBase64: "A" },
    { mimeType: "image/png", dataBase64: "!!!!" },
  ])
    expect(() => McpProjectRequest.icon(body)).toThrow();
});

it("validates GitHub configuration and the enabled switch", () => {
  const input = {
    repoUrl: "https://github.com/owner/repo",
    syncIssues: true,
    syncStatus: true,
    syncComments: false,
    syncPullRequests: false,
    syncCommits: false,
    syncDirection: "push",
    syncIntervalMinutes: Object.values(GITHUB_SYNC_INTERVAL)[0],
  };
  expect(McpProjectRequest.gitHub(input)).toMatchObject({
    repoUrl: input.repoUrl,
  });
  expect(() =>
    McpProjectRequest.gitHub({ ...input, repoUrl: "http://example.com/repo" }),
  ).toThrow();
  expect(McpProjectRequest.gitHubSwitch({ syncEnabled: false })).toEqual({
    syncEnabled: false,
  });
});
