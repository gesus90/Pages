import { expect, it, vi } from "vitest";

import { PicaAcpToolTurns } from "@/backend/service/chat/acp/PicaAcpToolTurns";
import { createPicaTools } from "@/backend/service/chat/PicaTools";
import { PICA_TOOL_OUTCOME } from "@/backend/service/chat/PicaToolSchemas";

import type { RuntimeToolInvocation } from "@/backend/agents/runtime/RuntimeToolRegistry";
import type { AgentLogbookTools } from "@/definition/AgentLogbook";
import { partialStub } from "../../stub-fixture";

const NAMES = ["lagebuch_merken", "lagebuch_suchen", "lagebuch_lesen"];

function registryOf(
  logbook: AgentLogbookTools | undefined,
): ReturnType<typeof createPicaTools> {
  return createPicaTools({
    tools: { run: vi.fn() },
    sessions: { confirmationWord: async () => "LÖSCHEN" },
    authorize: async () => undefined,
    ...(logbook ? { logbook } : {}),
  });
}

async function call(
  registry: ReturnType<typeof registryOf>,
  tool: string,
  parameters: unknown,
): Promise<RuntimeToolInvocation | null> {
  const invocation = await registry.invoke(tool, parameters, {
    userId: "agent",
    sessionId: "session",
    runId: "run",
    signal: new AbortController().signal,
    authorize: async () => undefined,
  });
  return invocation;
}

function logbookStub(): {
  readonly tools: AgentLogbookTools;
  readonly remember: ReturnType<typeof vi.fn>;
  readonly search: ReturnType<typeof vi.fn>;
  readonly read: ReturnType<typeof vi.fn>;
} {
  const remember = vi.fn(async () => ({ gespeichert: true }));
  const search = vi.fn(async () => ({ eintraege: [{ text: "PAGE-370" }] }));
  const read = vi.fn(async () => ({ eintraege: [] }));
  return { tools: { remember, search, read }, remember, search, read };
}

it("offers the three Lagebuch tools only to a session that has the Lagebuch", () => {
  const withLogbook = registryOf(logbookStub().tools)
    .describe({ includeAdministrator: false })
    .map((tool) => tool.id);
  for (const name of NAMES) expect(withLogbook).toContain(name);
  const without = registryOf(undefined)
    .describe({ includeAdministrator: false })
    .map((tool) => tool.id);
  for (const name of NAMES) expect(without).not.toContain(name);
});

it("passes the checked input of the model to the Lagebuch and answers its result", async () => {
  const stub = logbookStub();
  const registry = registryOf(stub.tools);

  const remembered = await call(registry, "lagebuch_merken", {
    art: "entscheidung",
    text: "PAGE-370 übernimmt Ed bis Freitag.",
  });
  expect(stub.remember).toHaveBeenCalledWith({
    art: "entscheidung",
    text: "PAGE-370 übernimmt Ed bis Freitag.",
  });
  expect(PICA_TOOL_OUTCOME.parse(remembered?.output)).toEqual({
    ok: true,
    result: JSON.stringify({ gespeichert: true }),
    error: null,
  });

  const searched = await call(registry, "lagebuch_suchen", {
    text: "PAGE-370",
  });
  expect(stub.search).toHaveBeenCalledWith({ text: "PAGE-370" });
  expect(PICA_TOOL_OUTCOME.parse(searched?.output).result).toContain(
    "PAGE-370",
  );

  await call(registry, "lagebuch_lesen", {
    chat: "Pages-Team",
    thema: "Release",
  });
  expect(stub.read).toHaveBeenCalledWith({
    chat: "Pages-Team",
    thema: "Release",
  });
});

it("refuses input that does not fit before it reaches the Lagebuch", async () => {
  const stub = logbookStub();
  const registry = registryOf(stub.tools);
  for (const [tool, parameters] of [
    ["lagebuch_merken", { art: "gerücht", text: "x" }],
    ["lagebuch_merken", { art: "fakt", text: "" }],
    ["lagebuch_merken", { art: "fakt", text: "x".repeat(501) }],
    ["lagebuch_merken", { art: "fakt", text: "x", agentId: "other" }],
    ["lagebuch_suchen", {}],
    ["lagebuch_lesen", { agentId: "other" }],
  ] as const) {
    const invocation = await call(registry, tool, parameters);
    expect(invocation?.isValid).toBe(false);
  }
  expect(stub.remember).not.toHaveBeenCalled();
  expect(stub.search).not.toHaveBeenCalled();
  expect(stub.read).not.toHaveBeenCalled();
});

it("lists the Lagebuch tools in the catalog of the turns of a job that has the Lagebuch", async () => {
  const stub = logbookStub();
  const dependencies = {
    tools: { run: vi.fn() },
    sessions: { confirmationWord: async () => "LÖSCHEN" },
  };
  const withLogbook = new PicaAcpToolTurns(
    partialStub<never>({ ...dependencies, logbook: stub.tools }),
    () => "run",
  );
  const ids = (await withLogbook.catalog("agent")).map((tool) => tool.id);
  for (const name of NAMES) expect(ids).toContain(name);

  const without = new PicaAcpToolTurns(dependencies as never, () => "run");
  const idsWithout = (await without.catalog("agent")).map((tool) => tool.id);
  for (const name of NAMES) expect(idsWithout).not.toContain(name);
});
