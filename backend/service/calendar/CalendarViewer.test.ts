import { describe, expect, it, vi } from "vitest";

import { PERMISSION } from "@/definition/Role";

import { serverTimeZone } from "./CalendarTime";
import {
  readCalendarTimeZone,
  readCalendarViewer,
  type CalendarDependencies,
} from "./CalendarViewer";

import type { User } from "@/definition/User";

const user = { id: "u1", username: "ada" } as unknown as User;

function settingsOf(
  timezone: string | null,
): Pick<CalendarDependencies["settings"], "getUserSettings"> {
  return {
    getUserSettings: vi.fn(async () => ({ timezone, language: "de" })),
  } as unknown as CalendarDependencies["settings"];
}

describe("readCalendarTimeZone", () => {
  it("uses a known zone of the account", async () => {
    expect(await readCalendarTimeZone(settingsOf("Europe/Berlin"), "u1")).toBe(
      "Europe/Berlin",
    );
  });

  it("falls back to the server zone for no or an unknown zone", async () => {
    expect(await readCalendarTimeZone(settingsOf(null), "u1")).toBe(
      serverTimeZone(),
    );
    expect(await readCalendarTimeZone(settingsOf("Nowhere/Land"), "u1")).toBe(
      serverTimeZone(),
    );
  });
});

describe("readCalendarViewer", () => {
  function dependenciesOf(timezone: string | null): CalendarDependencies {
    return {
      settings: settingsOf(timezone),
      directory: {
        findMemberships: vi.fn(async () => ({
          groupIds: ["g1"],
          departmentIds: ["d1"],
        })),
      },
      projects: {
        findAssigned: vi.fn(async () => [{ project: { id: "p1", name: "P" } }]),
      },
      permissions: { allows: vi.fn(async () => true) },
    } as unknown as CalendarDependencies;
  }

  it("collects settings, memberships, projects and the admin right", async () => {
    const dependencies = dependenciesOf("Europe/Berlin");

    expect(await readCalendarViewer(dependencies, user)).toEqual({
      user,
      timeZone: "Europe/Berlin",
      language: "de",
      groupIds: ["g1"],
      departmentIds: ["d1"],
      projects: [{ id: "p1", name: "P" }],
      isAdmin: true,
    });
    expect(dependencies.permissions.allows).toHaveBeenCalledWith(
      user,
      PERMISSION.MANAGE_APPLICATION,
    );
  });

  it("uses the server zone for a missing or unknown zone", async () => {
    for (const timezone of [null, "Nowhere/Land"])
      expect(
        (await readCalendarViewer(dependenciesOf(timezone), user)).timeZone,
      ).toBe(serverTimeZone());
  });
});
