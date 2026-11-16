import { expect, it, vi } from "vitest";

import { OpenCodeProviderLinks } from "@/backend/service/agents/OpenCodeProviderLinks";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AccountAccess } from "@/definition/Authorization";

const actor = partial<AccountAccess>({ userId: "admin" });

it("checks only active linked providers with a key", async () => {
  const find = vi
    .fn<AgentConnectionRepository["find"]>()
    .mockResolvedValueOnce(
      partial({ provider: "openrouter", isActive: true, hasApiKey: true }),
    )
    .mockResolvedValueOnce(
      partial({ provider: "openrouter", isActive: true, hasApiKey: false }),
    )
    .mockResolvedValueOnce(
      partial({ provider: "openai", isActive: true, hasApiKey: true }),
    )
    .mockResolvedValueOnce(null);
  const check = vi.fn(async () => undefined);
  const links = new OpenCodeProviderLinks({
    connections: partial({ find }),
    check,
  });
  for (const id of ["active", "missing-key", "unlinked", "missing"])
    await links.afterKeyChange(actor, id);
  expect(check).toHaveBeenCalledOnce();
  expect(check).toHaveBeenCalledWith(actor, "active");
});

it("activates the free provider and contains an unavailable check", async () => {
  const find = vi
    .fn<AgentConnectionRepository["find"]>()
    .mockResolvedValueOnce(partial({ provider: "opencode", isActive: true }))
    .mockResolvedValueOnce(partial({ provider: "opencode", isActive: false }))
    .mockResolvedValueOnce(partial({ provider: "openrouter", isActive: true }));
  const check = vi.fn(async () => {
    throw new Error("offline");
  });
  const links = new OpenCodeProviderLinks({
    connections: partial({ find }),
    check,
  });
  await expect(links.activate(actor, "active")).resolves.toBeUndefined();
  await links.activate(actor, "inactive");
  await links.activate(actor, "other");
  expect(check).toHaveBeenCalledOnce();
});
