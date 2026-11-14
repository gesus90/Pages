import { describe, expect, it, vi } from "vitest";

import { DatabaseUnavailableError } from "@/backend/database/executor/DatabaseExecutorErrors";
import { CalendarError } from "@/backend/error/CalendarError";
import { McpDeviceError } from "@/backend/error/McpDeviceError";
import { McpCalendarApi } from "@/backend/service/mcp/calendar/McpCalendarApi";
import {
  McpCalendarError,
  toMcpCalendarError,
} from "@/backend/service/mcp/calendar/McpCalendarError";

import { ADA, mockCalendar } from "./mcp-calendar-fixtures";

import type { McpCalendarAccess } from "@/backend/service/mcp/calendar/McpCalendarApi";
import type { McpCalendarService } from "@/backend/service/mcp/calendar/McpCalendarContext";
import type { User } from "@/definition/User";

function accessFor(
  account: User | null,
  access: "read_only" | "workspace" | null = null,
): McpCalendarAccess & { agents: { find: ReturnType<typeof vi.fn> } } {
  return {
    devices: {
      authenticate: vi.fn().mockResolvedValue({
        apiVersion: "1",
        deviceId: "d1",
        deviceName: "Laptop",
        pairedAt: 0,
        account: { displayName: "Ada", username: "ada" },
      }),
    },
    accounts: {
      findCredentialsByUsername: vi
        .fn()
        .mockResolvedValue(
          account === null ? null : { user: account, passwordHash: "hash" },
        ),
    },
    agents: {
      find: vi.fn().mockResolvedValue(access === null ? null : { access }),
    },
  };
}

function apiFor(access: McpCalendarAccess): McpCalendarApi {
  return new McpCalendarApi(
    mockCalendar() as unknown as McpCalendarService,
    access,
  );
}

describe("calendar API authentication", () => {
  it("opens a writing context for a person without asking the agents", async () => {
    const access = accessFor(ADA);
    const context = await apiFor(access).authenticate("Bearer token");
    expect(context.actor).toBe(ADA);
    expect(context.isReadOnly).toBe(false);
    expect(access.agents.find).not.toHaveBeenCalled();
  });

  it("makes an agent with read-only or no stored access a reader", async () => {
    const agent = { ...ADA, id: "pica", isAgent: true };
    expect(
      (await apiFor(accessFor(agent, "read_only")).authenticate("Bearer t"))
        .isReadOnly,
    ).toBe(true);
    expect(
      (await apiFor(accessFor(agent)).authenticate("Bearer t")).isReadOnly,
    ).toBe(true);
    expect(
      (await apiFor(accessFor(agent, "workspace")).authenticate("Bearer t"))
        .isReadOnly,
    ).toBe(false);
  });

  it("refuses a missing or deactivated account with invalid_token", async () => {
    for (const account of [null, { ...ADA, isActive: false }]) {
      const failure = await apiFor(accessFor(account))
        .authenticate("Bearer t")
        .catch((caught: unknown) => caught);
      expect(failure instanceof McpCalendarError ? failure.code : null).toBe(
        "invalid_token",
      );
    }
  });
});

describe("calendar API errors", () => {
  it("maps calendar failures and keeps only the revision of a conflict", () => {
    const conflict = toMcpCalendarError(
      new CalendarError("conflict", "Event 'Secret' changed", 7),
    );
    expect(conflict?.status).toBe(409);
    expect(conflict?.toBody()).toEqual({
      error: "conflict",
      currentRevision: 7,
    });
    expect(conflict?.headers()).toEqual({});
    expect(
      toMcpCalendarError(new CalendarError("conflict", "reused"))?.toBody(),
    ).toEqual({ error: "conflict" });
    const notFound = toMcpCalendarError(
      new CalendarError("not_found", "hidden", 4),
    );
    expect(notFound?.toBody()).toEqual({ error: "not_found" });
    expect(
      toMcpCalendarError(new CalendarError("too_large", "x"))?.status,
    ).toBe(413);
  });

  it("maps the token check, its limit and an unavailable database", () => {
    expect(
      toMcpCalendarError(new McpDeviceError("invalid_token", 401))?.status,
    ).toBe(401);
    const limited = toMcpCalendarError(
      new McpDeviceError("slow_down", 429, 30),
    );
    expect(limited?.toBody()).toEqual({ error: "rate_limited" });
    expect(limited?.headers()).toEqual({ "Retry-After": "30" });
    const unavailable = toMcpCalendarError(new DatabaseUnavailableError());
    expect(unavailable?.status).toBe(503);
    expect(unavailable?.headers()).toEqual({ "Retry-After": "10" });
    expect(new McpCalendarError("rate_limited").headers()).toEqual({
      "Retry-After": "5",
    });
  });

  it("leaves other failures to the internal error answer", () => {
    expect(
      toMcpCalendarError(new McpDeviceError("invalid_request")),
    ).toBeNull();
    expect(toMcpCalendarError(new Error("boom"))).toBeNull();
    const own = new McpCalendarError("forbidden");
    expect(toMcpCalendarError(own)).toBe(own);
  });
});
