import { expect, it } from "vitest";

import { McpAgentRequest } from "@/backend/service/mcp/agent/McpAgentRequest";

it("validates creation without accepting administrator or password fields", () => {
  const input = {
    name: " Agent ",
    username: "agent",
    position: "Helper",
    model: { connectionId: "connection", modelId: "model" },
    access: "read_only",
    roleId: "member",
  };
  expect(McpAgentRequest.create(input)).toMatchObject({
    name: "Agent",
    roleId: "member",
  });
  expect(() => McpAgentRequest.create({ ...input, roleId: "admin" })).toThrow();
  expect(() =>
    McpAgentRequest.create({ ...input, password: "secret" }),
  ).toThrow();
  expect(() =>
    McpAgentRequest.create({
      ...input,
      model: { connectionId: "", modelId: "model" },
    }),
  ).toThrow();
});

it("requires a revision and at least one valid field for updates", () => {
  expect(McpAgentRequest.update({ revision: 1, name: " New " })).toEqual({
    revision: 1,
    name: "New",
  });
  expect(() => McpAgentRequest.update({ revision: 1 })).toThrow();
  expect(() => McpAgentRequest.update({ revision: 0, name: "New" })).toThrow();
  expect(() =>
    McpAgentRequest.update({ revision: 1, isAdmin: true }),
  ).toThrow();
});

it("checks image, removal and restore inputs", () => {
  expect(
    McpAgentRequest.image({ mimeType: "image/png", dataBase64: "AQID" }),
  ).toMatchObject({ mimeType: "image/png" });
  expect(() =>
    McpAgentRequest.image({ mimeType: "image/png", dataBase64: "" }),
  ).toThrow();
  expect(McpAgentRequest.removal({ revision: 2, confirmed: true })).toEqual({
    revision: 2,
    confirmed: true,
  });
  expect(McpAgentRequest.restore({ revision: 2 })).toEqual({ revision: 2 });
  expect(() => McpAgentRequest.restore({ revision: 1.5 })).toThrow();
});

it("validates list and cursor queries without accepting duplicate parameters", () => {
  expect(McpAgentRequest.list(new URLSearchParams("status=active"))).toEqual({
    status: "active",
  });
  expect(McpAgentRequest.archive(new URLSearchParams("cursor=123"))).toEqual({
    cursor: "123",
  });
  expect(McpAgentRequest.activity(new URLSearchParams("cursor=0"))).toEqual({
    cursor: "0",
  });
  expect(() =>
    McpAgentRequest.activity(new URLSearchParams("cursor=-1")),
  ).toThrow();
  expect(() =>
    McpAgentRequest.list(new URLSearchParams("status=active&status=inactive")),
  ).toThrow();
  expect(() => McpAgentRequest.empty(new URLSearchParams("extra=1"))).toThrow();
});
