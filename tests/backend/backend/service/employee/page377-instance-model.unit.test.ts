import { expect, it, vi } from "vitest";

import { SimulatedAgentMemoryModel } from "@/backend/agents/simulation/SimulatedAgentMemoryModel";
import { AgentSessionLimitService } from "@/backend/service/employee/AgentSessionLimitService";
import { createAgentEmployeeInstructions } from "@/backend/service/employee/AgentEmployeeInstructions";

import type { AgentSessionSettingsRepository } from "@/backend/database/repositories/employee/AgentSessionSettingsRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { User } from "@/definition/User";

const LIMITS = {
  perAgent: 4,
  total: 16,
  revision: 2,
  dreamTime: "03:00",
  idleMinutes: 30,
};
const ADMINISTRATOR: AccountAccess = {
  userId: "admin",
  role: null,
  isAdmin: true,
  mode: "admin",
  firstName: "Ada",
  lastName: "Admin",
  isActive: true,
  departments: [],
  managedDepartments: [],
  allDepartments: true,
  allProjects: true,
  hasHadDepartment: false,
};
const CHEAP = {
  id: "cheap",
  connectionId: "cheap-connection",
  model: "cheap-model",
  name: "Cheap Model",
} as unknown as PageAgentModel;

function service(logbookModel: { connectionId: string; model: string } | null = null) {
  const saveLogbookModel = vi.fn(async () => undefined);
  const settings: unknown = {
    read: vi.fn(async () => LIMITS),
    save: vi.fn(),
    logbookModel: vi.fn(async () => logbookModel),
    saveLogbookModel,
  };
  const limits = new AgentSessionLimitService(
    settings as AgentSessionSettingsRepository,
    { apply: vi.fn(), running: 1, waiting: 2 },
    async () => [CHEAP],
  );
  return { limits, saveLogbookModel };
}

it("shows the model of the instance for the Lagebuch summary with the models an administrator may choose", async () => {
  const { limits } = service({ connectionId: "cheap-connection", model: "cheap-model" });
  await expect(limits.administration(ADMINISTRATOR)).resolves.toEqual({
    limits: LIMITS,
    running: 1,
    waiting: 2,
    logbookModel: { connectionId: "cheap-connection", model: "cheap-model" },
    logbookModels: [
      { connectionId: "cheap-connection", model: "cheap-model", label: "Cheap Model" },
    ],
  });
});

it("saves the instance model of the Lagebuch summary, clears it with empty fields and refuses any other", async () => {
  const { limits, saveLogbookModel } = service();
  await limits.saveLogbookModel(ADMINISTRATOR, {
    connectionId: "cheap-connection",
    model: "cheap-model",
  });
  expect(saveLogbookModel).toHaveBeenLastCalledWith({
    connectionId: "cheap-connection",
    model: "cheap-model",
  });
  await limits.saveLogbookModel(ADMINISTRATOR, { connectionId: "", model: "" });
  expect(saveLogbookModel).toHaveBeenLastCalledWith(null);
  for (const input of [
    { connectionId: "cheap-connection", model: "" },
    { connectionId: "", model: "cheap-model" },
    { connectionId: "other", model: "other-model" },
    {},
  ])
    await expect(limits.saveLogbookModel(ADMINISTRATOR, input)).rejects.toMatchObject({
      code: "profile_invalid",
    });
  expect(saveLogbookModel).toHaveBeenCalledTimes(2);
  await expect(
    limits.saveLogbookModel({ ...ADMINISTRATOR, isAdmin: false, mode: "role" }, {
      connectionId: "",
      model: "",
    }),
  ).rejects.toBeDefined();
});

const BASE = {
  name: "Ed",
  position: null,
  roleName: null,
  soul: "",
  instructions: "",
  memory: "",
  dream: "",
  related: [],
  access: "read_only" as const,
};

it("adds the Lagebuch rule to the instruction of a chat and the one hint line at its end", () => {
  const text = createAgentEmployeeInstructions({
    ...BASE,
    personName: "Igor",
    hasLogbook: true,
    logbookHint: "Lagebuch: 3 neue Einträge (PAGE-370, Release Freitag, Testserver)",
  });
  expect(text).toContain("Dein Lagebuch:");
  expect(text).toContain("lagebuch_merken(art, text)");
  expect(text).toContain("Aus einem vertraulichen Chat steht nichts im Lagebuch");
  expect(
    text.endsWith("Lagebuch: 3 neue Einträge (PAGE-370, Release Freitag, Testserver)"),
  ).toBe(true);
});

it("leaves the rule out without the tools and everything of the Lagebuch out of a run without a person", () => {
  const noTools = createAgentEmployeeInstructions({
    ...BASE,
    personName: "Igor",
    logbookHint: null,
  });
  expect(noTools).not.toContain("Lagebuch");
  const run = createAgentEmployeeInstructions({
    ...BASE,
    personName: null,
    hasLogbook: true,
    logbookHint: "Lagebuch: 1 neuer Eintrag (x)",
  });
  expect(run).not.toContain("Lagebuch");
});

it("lets the simulation derive entries from the messages without a model provider", async () => {
  const model = new SimulatedAgentMemoryModel();
  const agent = { id: "ed", displayName: "Ed" } as User;
  const drafts = await model.logbook(
    { agent, employee: {} as never },
    {
      chat: "Gruppe „Team“",
      existing: [],
      messages: [
        { from: "Igor", at: "2026-11-13T17:00:00.000Z", text: "Wir haben beschlossen: PAGE-370 macht Ed." },
        { from: "Ed", at: "2026-11-13T17:01:00.000Z", text: "Alles klar, PAGE-370 bis Freitag." },
        { from: "Mei", at: "2026-11-13T17:02:00.000Z", text: "Guten Morgen!" },
        { from: "Mei", at: "2026-11-13T17:03:00.000Z", text: "Die Notizen schreibe ich bis Mittwoch." },
      ],
    },
  );
  expect(drafts).toEqual([
    { kind: "open", text: "Mei: Die Notizen schreibe ich bis Mittwoch." },
    { kind: "decision", text: "Igor: Wir haben beschlossen: PAGE-370 macht Ed." },
  ]);
});
