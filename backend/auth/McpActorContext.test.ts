import { expect, it } from "vitest";

import { accountForChannel, agentChannelPolicy } from "./McpActorContext";

import type { AccountAccess } from "@/definition/Authorization";

function account(overrides: Partial<AccountAccess> = {}): AccountAccess {
  return {
    userId: "user-1",
    role: null,
    isAdmin: false,
    mode: "role",
    firstName: "Ada",
    lastName: "Lovelace",
    isActive: true,
    departments: [],
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: false,
    ...overrides,
  };
}

it("grants the administrator interpretation to an administrator on the MCP channel only", () => {
  const administrator = account({ isAdmin: true, mode: "role" });

  expect(accountForChannel(administrator, "mcp").mode).toBe("admin");
  expect(accountForChannel(administrator, "ui")).toBe(administrator);
});

it("keeps the persisted mode of an account that is not an administrator", () => {
  const employee = account({ isAdmin: false, mode: "role" });

  expect(accountForChannel(employee, "mcp")).toBe(employee);
});

it("maps the chat agent to the interface actor with AI activity", () => {
  expect(agentChannelPolicy("chat")).toEqual({ actor: "ui", source: "ai" });
});

it("maps the MCP agent to the MCP actor with MCP activity", () => {
  expect(agentChannelPolicy("mcp")).toEqual({ actor: "mcp", source: "mcp" });
});
