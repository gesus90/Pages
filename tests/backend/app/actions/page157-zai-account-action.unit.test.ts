import { expect, it, vi } from "vitest";

import { handleAgentsAction } from "@/app/lib/settings-actions/settings-agents-actions.server";

import { settingsContext } from "./action-fixtures";

import type { AccountAccess } from "@/definition/Authorization";

const ACCOUNT: AccountAccess = {
  userId: "actor",
  role: null,
  isActive: true,
  isAdmin: true,
  mode: "admin",
  firstName: "Actor",
  lastName: "",
  departments: [],
  managedDepartments: [],
  allDepartments: true,
  allProjects: true,
  hasHadDepartment: false,
};

it("refreshes linked access and catalogs after an account-only update with the retained key", async () => {
  const update = vi.fn(async () => undefined);
  const afterKeyChange = vi.fn(async () => undefined);
  const context = settingsContext(
    {
      administrationService: { getContext: async () => ACCOUNT },
      agentConnectionService: { update },
      openCodeProviderLinks: { afterKeyChange },
    },
    {
      intent: "update-connection",
      connectionId: "zai",
      name: "z.ai",
      zaiAccountType: "coding-plan",
      apiKey: "",
    },
  );
  const response = await handleAgentsAction(context);
  expect(response.status).toBe(200);
  expect(update).toHaveBeenCalledWith(
    ACCOUNT,
    "zai",
    expect.objectContaining({ zaiAccountType: "coding-plan", apiKey: "" }),
  );
  expect(afterKeyChange).toHaveBeenCalledWith(ACCOUNT, "zai");
});

it("does not recheck an unchanged credential when saving only connection metadata", async () => {
  const afterKeyChange = vi.fn(async () => undefined);
  const context = settingsContext(
    {
      administrationService: { getContext: async () => ACCOUNT },
      agentConnectionService: { update: async () => undefined },
      openCodeProviderLinks: { afterKeyChange },
    },
    {
      intent: "update-connection",
      connectionId: "zai",
      name: "Renamed",
      apiKey: "",
    },
  );
  expect((await handleAgentsAction(context)).status).toBe(200);
  expect(afterKeyChange).not.toHaveBeenCalled();
});
