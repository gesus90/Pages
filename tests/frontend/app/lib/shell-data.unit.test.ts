import { describe, expect, it } from "vitest";

import { isShellData } from "@/app/lib/shell-data";

const SHELL = {
  account: { role: "member" },
  authorizationVersion: "v1",
  user: { id: "user-1", name: "Ada" },
  canViewProjects: true,
  canViewUsers: false,
  region: { timezone: "UTC" },
  branding: { companyName: "Acme" },
  isPicaEnabled: false,
};

describe("isShellData", () => {
  it("accepts a complete answer", () => {
    expect(isShellData(SHELL)).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "shell"],
    ["a missing user", { ...SHELL, user: undefined }],
    ["a null user", { ...SHELL, user: null }],
    ["a user without id", { ...SHELL, user: { name: "Ada" } }],
    ["a user with a numeric id", { ...SHELL, user: { id: 1 } }],
    [
      "a missing authorization version",
      { ...SHELL, authorizationVersion: undefined },
    ],
    ["a numeric authorization version", { ...SHELL, authorizationVersion: 1 }],
    ["a missing account", { ...SHELL, account: undefined }],
    ["a null account", { ...SHELL, account: null }],
    ["a missing region", { ...SHELL, region: undefined }],
    ["a null region", { ...SHELL, region: null }],
    ["a missing branding", { ...SHELL, branding: undefined }],
    ["null branding", { ...SHELL, branding: null }],
    ["a missing project permission", { ...SHELL, canViewProjects: undefined }],
    ["a text project permission", { ...SHELL, canViewProjects: "yes" }],
    ["a missing user permission", { ...SHELL, canViewUsers: undefined }],
    ["a text user permission", { ...SHELL, canViewUsers: "no" }],
    ["a missing Pica flag", { ...SHELL, isPicaEnabled: undefined }],
    ["a numeric Pica flag", { ...SHELL, isPicaEnabled: 0 }],
  ])("refuses %s", (label, value) => {
    expect(isShellData(value)).toBe(false);
  });
});
