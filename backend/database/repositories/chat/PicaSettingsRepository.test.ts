import { expect, it, vi, type Mock } from "vitest";

import { PicaSettingsRepository } from "./PicaSettingsRepository";

import { readAgentConfiguration } from "@/backend/agents/AgentConfigurationInput";

import type * as ConfigurationInput from "@/backend/agents/AgentConfigurationInput";
import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { PicaSettings } from "@/definition/PicaSettings";

vi.mock("@/backend/agents/AgentConfigurationInput", async (original) => {
  const actual = await original<typeof ConfigurationInput>();
  return {
    ...actual,
    readAgentConfiguration: vi.fn(actual.readAgentConfiguration),
  };
});

const SELECTION = { connectionId: "c1", model: "m", reasoningEffort: null };
const RUN = {
  access: "read_only",
  shell: false,
  web: true,
  timeoutMinutes: 10,
};

function databaseOf(rows: DatabaseValue[][]): {
  readonly database: Database;
  readonly query: Mock<Database["query"]>;
} {
  const query = vi.fn<Database["query"]>(async () => rows);
  const transaction = vi.fn(
    async (work: (inner: Pick<Database, "query">) => Promise<void>) => {
      await work({ query });
    },
  );
  return {
    database: { query, transaction } as unknown as Database,
    query,
  };
}

it("reads the settings with a selection and run options", async () => {
  const { database } = databaseOf([
    [1, JSON.stringify(SELECTION), JSON.stringify(RUN), 4, 0],
  ]);
  await expect(new PicaSettingsRepository(database).read()).resolves.toEqual({
    isEnabled: true,
    selection: SELECTION,
    run: RUN,
    revision: 4,
    legacyChecked: false,
  });
});

it("reads empty selection and run options", async () => {
  const { database } = databaseOf([[0, null, null, 0, 1]]);
  await expect(new PicaSettingsRepository(database).read()).resolves.toEqual({
    isEnabled: false,
    selection: null,
    run: null,
    revision: 0,
    legacyChecked: true,
  });
});

it("rejects a missing settings row", async () => {
  const { database } = databaseOf([]);
  await expect(
    new PicaSettingsRepository(database).read(),
  ).rejects.toMatchObject({ code: "profile_invalid" });
});

it("rejects a malformed stored selection", async () => {
  for (const selection of [
    { connectionId: 1, model: "m", reasoningEffort: null },
    { connectionId: "c", model: 1, reasoningEffort: null },
    { connectionId: "c", model: "m", reasoningEffort: 1 },
  ]) {
    const { database } = databaseOf([
      [1, JSON.stringify(selection), null, 0, 0],
    ]);
    await expect(
      new PicaSettingsRepository(database).read(),
    ).rejects.toMatchObject({ code: "profile_invalid" });
  }
});

it("saves the settings with the revision they were read at", async () => {
  const { database, query } = databaseOf([["1"]]);
  const settings: PicaSettings = {
    isEnabled: true,
    selection: SELECTION,
    run: RUN as PicaSettings["run"],
    revision: 2,
  };
  await new PicaSettingsRepository(database).save(settings);
  expect(query.mock.calls[0]?.[1]).toEqual({
    enabled: true,
    selection: JSON.stringify(SELECTION),
    run: JSON.stringify(RUN),
    revision: 2,
  });
});

it("saves empty selection and run options as null", async () => {
  const { database, query } = databaseOf([["1"]]);
  await new PicaSettingsRepository(database).save({
    isEnabled: false,
    selection: null,
    run: null,
    revision: 0,
  });
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    selection: null,
    run: null,
  });
});

it("rejects a save on a changed revision", async () => {
  const { database } = databaseOf([]);
  await expect(
    new PicaSettingsRepository(database).save({
      isEnabled: false,
      selection: null,
      run: null,
      revision: 0,
    }),
  ).rejects.toMatchObject({ code: "profile_conflict" });
});

it("reads no run options when the configuration carries none", async () => {
  vi.mocked(readAgentConfiguration).mockReturnValueOnce({
    scope: "system",
    tag: "",
    markdown: "",
    projectId: null,
    accessMode: "personal",
    sharing: { isGlobal: false, targets: [] },
    parameters: [],
  } as unknown as ReturnType<typeof readAgentConfiguration>);
  const { database } = databaseOf([[1, null, JSON.stringify(RUN), 0, 0]]);
  await expect(
    new PicaSettingsRepository(database).read(),
  ).resolves.toMatchObject({ run: null });
});
