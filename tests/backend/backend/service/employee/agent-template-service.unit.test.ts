import { expect, it, vi } from "vitest";

import {
  AgentTemplateService,
  readAgentTemplateInput,
} from "@/backend/service/employee/AgentTemplateService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentTemplateServiceDependencies } from "@/backend/service/employee/AgentTemplateService";

it("normalizes template text and rejects empty names or NUL bytes", () => {
  expect(
    readAgentTemplateInput({
      name: " Name ",
      description: " Description ",
      content: "line\r\nnext",
    }),
  ).toEqual({
    name: "Name",
    description: "Description",
    content: "line\nnext",
  });
  expect(() => readAgentTemplateInput({ name: " " })).toThrow();
  expect(() =>
    readAgentTemplateInput({ name: "Name", content: "bad\u0000text" }),
  ).toThrow();
});

it("lists seeded templates only for authorized administration", async () => {
  const list = vi.fn(async () => [{ id: "template" }]);
  const dependencies = partial<AgentTemplateServiceDependencies>({
    authorization: {
      snapshot: async () => ({
        accounts: [
          { userId: "admin", isActive: true, isAdmin: true, mode: "admin" },
        ],
      }),
    },
    store: { templates: () => ({ isSeeded: async () => true, list }) },
  });
  const service = new AgentTemplateService(dependencies);
  await expect(service.list("admin")).resolves.toEqual({
    templates: [{ id: "template" }],
    canManage: true,
  });
  await expect(service.list("missing")).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(service.find("../bad")).resolves.toBeNull();
  expect(list).toHaveBeenCalledOnce();
});
