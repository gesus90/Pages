import { expect, it } from "vitest";

import {
  HEX_64,
  THREAD,
  TOOLS,
  TURN,
  boundRig,
  policyRig,
  readyFor,
  rig,
} from "./pica-codex-requests-harness";

import type { PicaCodexTool } from "@/backend/agents/acp/PicaCodexGlue";

it("issues the catalog once and withholds a policy context without a policy build", async () => {
  const { requests, catalog } = rig();

  await expect(requests.catalog()).resolves.toEqual(TOOLS);

  expect(requests.catalogContext()).toBeNull();
  expect(catalog).toHaveBeenCalledTimes(1);
  await expect(requests.catalog()).rejects.toThrow("Pica request refused");
});

it("issues a random 64-hex policy context under the policy build", async () => {
  const { requests } = rig(true);

  await requests.catalog();

  expect(requests.catalogContext()).toMatch(HEX_64);
});

const MANY_TOOLS: readonly PicaCodexTool[] = Array.from(
  { length: 513 },
  (_, index) => ({ ...TOOLS[0], name: `tool-${index}` }),
);

it.each([
  { label: "an empty catalog", tools: [] },
  { label: "duplicate names", tools: [TOOLS[0], TOOLS[0]] },
  { label: "more than 512 tools", tools: MANY_TOOLS },
])("refuses $label", async ({ tools }) => {
  const { requests, catalog } = rig();
  catalog.mockResolvedValueOnce(tools);

  await expect(requests.catalog()).rejects.toThrow("Pica catalog refused");
  expect(requests.bindThread(THREAD)).toBe(false);
});

it("maps a failing listener to a generic refused catalog", async () => {
  const { requests, catalog } = rig();
  catalog.mockRejectedValueOnce(new Error("secret internal detail"));

  await expect(requests.catalog()).rejects.toThrow("Pica catalog refused");
});

it("refuses a catalog that finishes loading after the connection closed", async () => {
  const { requests, catalog } = rig();
  let release: (tools: readonly PicaCodexTool[]) => void = () => undefined;
  catalog.mockReturnValueOnce(
    new Promise<readonly PicaCodexTool[]>((resolve) => {
      release = resolve;
    }),
  );

  const pending = requests.catalog();
  requests.close();
  release(TOOLS);

  await expect(pending).rejects.toThrow("Pica catalog refused");
  expect(requests.bindThread(THREAD)).toBe(false);
});

it("binds the one thread only after a catalog, with a valid context and no session yet", async () => {
  const fresh = rig();
  expect(fresh.requests.bindThread(THREAD)).toBe(false);

  const hasSession = rig();
  await hasSession.requests.catalog();
  hasSession.state.session = "other";
  expect(hasSession.requests.bindThread(THREAD)).toBe(false);

  const malformed = rig();
  await malformed.requests.catalog();
  expect(malformed.requests.bindThread(THREAD, "not-hex")).toBe(false);

  const ok = rig();
  await ok.requests.catalog();
  expect(ok.requests.bindThread(THREAD)).toBe(true);
  expect(ok.requests.bindThread("thread-2")).toBe(false);
});

it("requires the exact policy context under the policy build and burns it", async () => {
  const { requests } = rig(true);
  await requests.catalog();
  const context = requests.catalogContext() ?? "";

  expect(requests.bindThread(THREAD)).toBe(false);
  expect(requests.bindThread(THREAD, "0".repeat(64))).toBe(false);
  expect(requests.bindThread(THREAD, context)).toBe(true);
  expect(requests.catalogContext()).toBeNull();
});

it("confirms only the bound thread", async () => {
  const { requests } = await boundRig();

  expect(() => requests.confirmThread(THREAD)).not.toThrow();
  expect(() => requests.confirmThread("other")).toThrow("Pica thread refused");
});

it("captures the human operation for the live prompt without a policy", async () => {
  const { requests, capture } = await boundRig();

  expect(requests.bindTurn(THREAD, TURN)).toBe(true);
  expect(capture).toHaveBeenCalledTimes(1);
  expect(requests.bindTurn(THREAD, "turn-2")).toBe(false);
});

it("refuses to bind a turn for a foreign thread, an idle prompt or a stale binding", async () => {
  const r = await boundRig();
  expect(r.requests.bindTurn("other", TURN)).toBe(false);

  r.state.prompting = false;
  expect(r.requests.bindTurn(THREAD, TURN)).toBe(false);

  r.state.prompting = true;
  r.state.current = false;
  expect(r.requests.bindTurn(THREAD, TURN)).toBe(false);
});

it("refuses to bind a turn under the policy build", async () => {
  const policy = await policyRig();

  expect(policy.requests.bindTurn(THREAD, TURN)).toBe(false);
});

it("refuses to bind a turn id that already ended", async () => {
  const { requests } = await boundRig();
  requests.bindTurn(THREAD, TURN);
  await requests.endTurn(THREAD, TURN);

  expect(requests.bindTurn(THREAD, TURN)).toBe(false);
});

it("limits ended turns so a hostile adapter cannot grow the registry", async () => {
  const { requests } = await boundRig();
  for (let index = 0; index < 4096; index += 1) {
    expect(requests.bindTurn(THREAD, `turn-${index}`)).toBe(true);
    await requests.endTurn(THREAD, `turn-${index}`);
  }

  expect(requests.bindTurn(THREAD, "turn-next")).toBe(false);
});

it("refuses admission without a policy build", async () => {
  const plain = await boundRig();

  expect(
    plain.requests.admitReady(
      readyFor({ operationId: "o", nonce: "n", sequence: 1 }, "c"),
    ),
  ).toBe(false);
});
