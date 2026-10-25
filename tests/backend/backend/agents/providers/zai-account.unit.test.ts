import { expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { ZaiProvider } from "@/backend/agents/providers/ZaiProvider";
import { ProviderHttpClient } from "@/backend/agents/providers/ProviderHttpClient";
import { CatalogHttpClient } from "@/backend/agents/catalog/CatalogHttpClient";
import { CatalogProviderClient } from "@/backend/agents/catalog/CatalogProviderClient";
import { AgentConnectionService } from "@/backend/service/agents/AgentConnectionService";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { readZaiAccountType } from "@/backend/service/agents/AgentConnectionValidation";
import {
  apiProviderEndpoint,
  linkedApiProviderOf,
  openCodeLinkedModelProvider,
} from "@/definition/AgentConnection";

import { bareInstance } from "../../service/tasks/bare-instance";
import { ASSIGNMENT } from "../../service/chat/page48-chat-fixture";

import type { ProviderHttpTransport } from "@/backend/agents/providers/ProviderContracts";
import type { ZaiAccountType } from "@/definition/AgentConnection";
import type { AccountAccess } from "@/definition/Authorization";

it.each(["api", "coding-plan"] as const)(
  "checks %s through its fixed metadata endpoint without generating tokens",
  async (account) => {
    const request = vi.fn<ProviderHttpTransport>(async () => ({
      status: 200,
      json: async () => ({ data: [{ id: "glm-5.3-flash" }] }),
    }));
    const provider = new ZaiProvider(new ProviderHttpClient(request));
    expect(
      await provider.checkAccess(
        "synthetic-key",
        new AbortController().signal,
        account,
      ),
    ).toMatchObject({ ok: true, detail: { modelCount: 1 } });
    expect(request.mock.calls[0]?.[0]).toBe(
      `${apiProviderEndpoint("zai", account)}/models`,
    );
    expect(request.mock.calls[0]?.[1].method).toBe("GET");
    expect(request.mock.calls[0]?.[1].body).toBeUndefined();
    expect(request.mock.calls[0]?.[0]).not.toContain("synthetic-key");
  },
);

it.each(["api", "coding-plan"] as const)(
  "loads the %s catalog from the same fixed endpoint",
  async (account) => {
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({ data: [{ id: "glm-5.3-flash" }] }),
    );
    const catalog = new CatalogProviderClient(new CatalogHttpClient(request));
    const models = await catalog.list(
      "zai",
      "synthetic-key",
      new AbortController().signal,
      account,
    );
    expect(models.map(({ id }) => id)).toEqual(["glm-5.3-flash"]);
    expect(request.mock.calls[0]?.[0]).toBe(
      `${apiProviderEndpoint("zai", account)}/models`,
    );
  },
);

it("requires a deliberate account choice and registers Coding Plan under its exact native provider", () => {
  expect(() => readZaiAccountType({ name: "z.ai" }, "zai")).toThrow(
    new AgentError("zai_account_type_invalid"),
  );
  expect(() =>
    readZaiAccountType(
      { name: "z.ai", zaiAccountType: "custom-endpoint" },
      "zai",
    ),
  ).toThrow(new AgentError("zai_account_type_invalid"));
  expect(readZaiAccountType({ name: "z.ai" }, "zai", "api")).toBe("api");
  expect(
    openCodeLinkedModelProvider({
      provider: "zai",
      zaiAccountType: "coding-plan",
    }),
  ).toBe("zai-coding-plan");
  expect(openCodeLinkedModelProvider({ provider: "zai" })).toBe("zai");
  expect(linkedApiProviderOf("zai-coding-plan")).toBe("zai");
});

it.each(["api", "coding-plan"] as const)(
  "invalidates access only when changing from the saved %s account",
  async (previous) => {
    const repository = bareInstance(AgentConnectionRepository.prototype);
    vi.spyOn(repository, "find").mockResolvedValue({
      ...ASSIGNMENT.connection,
      provider: "zai",
      zaiAccountType: previous,
    });
    const update = vi.spyOn(repository, "update").mockResolvedValue();
    const actor: AccountAccess = {
      userId: "owner",
      role: null,
      isActive: true,
      isAdmin: true,
      mode: "admin",
      firstName: "Owner",
      lastName: "",
      departments: [],
      managedDepartments: [],
      allDepartments: true,
      allProjects: true,
      hasHadDepartment: false,
    };
    const service = new AgentConnectionService({
      repository,
      cipher: bareInstance(InstanceSecretCipher.prototype),
      operations: new AgentOperationRegistry(),
      cli: { describe: vi.fn(), cleanup: vi.fn() },
    });
    await service.update(actor, "connection", { name: "z.ai" });
    expect(update.mock.calls[0]?.[1]).toMatchObject({
      zaiAccountType: previous,
      clearAccess: false,
      secretEncrypted: null,
    });
    const next: ZaiAccountType = previous === "api" ? "coding-plan" : "api";
    await service.update(actor, "connection", {
      name: "z.ai",
      zaiAccountType: next,
    });
    expect(update.mock.calls[1]?.[1]).toMatchObject({
      zaiAccountType: next,
      clearAccess: true,
      secretEncrypted: null,
    });
  },
);
