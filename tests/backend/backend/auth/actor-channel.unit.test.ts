import { describe, expect, it } from "vitest";

import {
  accountForChannel,
  agentChannelPolicy,
} from "@/backend/auth/McpActorContext";

import { accountFixture, administratorFixture } from "./account-fixture";

describe("Pages-owned agent channel policy", () => {
  it("uses the stored role mode in the UI without changing the account", () => {
    const account = administratorFixture({ mode: "role", hasRole: true });

    expect(accountForChannel(account, "ui")).toBe(account);
    expect(account.mode).toBe("role");
  });

  it("uses administrator eligibility for MCP while preserving stored UI mode", () => {
    const account = administratorFixture({ mode: "role", hasRole: true });
    const current = accountForChannel(account, "mcp");

    expect(current).toEqual({ ...account, mode: "admin" });
    expect(current).not.toBe(account);
    expect(account.mode).toBe("role");
  });

  it("never elevates an ordinary account through an agent channel", () => {
    const account = accountFixture();

    expect(accountForChannel(account, "mcp")).toBe(account);
    expect(accountForChannel(account, "ui")).toBe(account);
  });

  it("preserves inactivity for downstream authorization", () => {
    const account = administratorFixture({ isActive: false, mode: "role" });

    expect(accountForChannel(account, "mcp").isActive).toBe(false);
  });

  it("uses UI authorization and AI attribution for chat operations", () => {
    expect(agentChannelPolicy("chat")).toEqual({ actor: "ui", source: "ai" });
  });

  it("uses MCP authorization and attribution for the Pages Agent API", () => {
    expect(agentChannelPolicy("mcp")).toEqual({ actor: "mcp", source: "mcp" });
  });
});
