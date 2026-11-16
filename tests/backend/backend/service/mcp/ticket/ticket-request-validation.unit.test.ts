import { expect, it } from "vitest";

import { McpTicketRequest } from "@/backend/service/mcp/ticket/McpTicketRequest";

it("validates calendar dates and rejects unknown ticket fields", () => {
  expect(
    McpTicketRequest.create({
      projectId: " project ",
      title: " Task ",
      startAt: "2024-02-29",
    }),
  ).toMatchObject({
    projectId: "project",
    title: "Task",
    startAt: "2024-02-29",
  });
  expect(() =>
    McpTicketRequest.create({ projectId: "project", startAt: "2025-02-29" }),
  ).toThrow();
  expect(() =>
    McpTicketRequest.create({ projectId: "project", unexpected: true }),
  ).toThrow();
  expect(() =>
    McpTicketRequest.patch({ expected: { title: "Old" } }),
  ).toThrow();
  expect(
    McpTicketRequest.patch({ title: "New", expected: { title: "Old" } }),
  ).toMatchObject({ title: "New" });
});

it("rejects duplicate search parameters and empty mutations", () => {
  expect(() =>
    McpTicketRequest.search(new URLSearchParams("projectId=one&projectId=two")),
  ).toThrow();
  expect(() => McpTicketRequest.labelUpdate({})).toThrow();
  expect(() => McpTicketRequest.templateUpdate({})).toThrow();
  expect(McpTicketRequest.confirmation({ confirmed: true })).toEqual({
    confirmed: true,
  });
  expect(() => McpTicketRequest.confirmation({ confirmed: false })).toThrow();
  expect(() => McpTicketRequest.empty({ extra: true })).toThrow();
});
