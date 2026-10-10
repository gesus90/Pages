import { describe, expect, it } from "vitest";

import { accountForChannel } from "@/backend/auth/McpActorContext";
import { createAccess } from "../helpers/authorization";

describe("MCP actor facts", () => {
  it("derives admin scope without mutating persisted role mode or the UI account", () => {
    const account = createAccess({ isAdmin: true, mode: "role" });
    expect(accountForChannel(account, "mcp")).toEqual({
      ...account,
      mode: "admin",
    });
    expect(account.mode).toBe("role");
    expect(accountForChannel(account, "ui")).toBe(account);
    const reader = createAccess();
    expect(accountForChannel(reader, "mcp")).toBe(reader);
  });
});
