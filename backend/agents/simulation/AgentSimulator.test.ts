import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { AgentSimulator } from "@/backend/agents/simulation/AgentSimulator";
import { AgentAssetError } from "@/backend/error/AgentAssetError";
import { AgentError } from "@/backend/error/AgentErrors";
import { AGENT_SIMULATION_CONNECTIONS } from "@/definition/AgentSimulation";
import { PLAN_HANDOVER_LIMITS } from "@/definition/AgentPlanHandover";

import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { AgentSimulationScenario } from "@/definition/AgentSimulation";

vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn(() => Promise.resolve()),
}));

function stub(value: object): never {
  return value as never;
}

const signal = new AbortController().signal;
const asset = { source: "plan", id: "a1", link: "l" } as const;

interface Built {
  readonly simulator: AgentSimulator;
  readonly assets: { readonly describe: Mock; readonly storeResult: Mock };
  readonly references: { readonly issue: Mock; readonly redeem: Mock };
}

function build(scenario: AgentSimulationScenario = "ok"): Built {
  const assets = {
    describe: vi.fn(() => Promise.resolve({ kind: "text", projectId: "p1" })),
    storeResult: vi.fn(() =>
      Promise.resolve({ fileName: "ergebnis-x.txt", assetId: "r1" }),
    ),
  };
  const references = {
    issue: vi.fn(() => Promise.resolve("ref")),
    redeem: vi.fn(() =>
      Promise.resolve({
        assetId: "a1",
        fileName: "x.txt",
        mediaType: "text/plain",
        size: 3,
        stream: Readable.from([Buffer.from("abc")]),
      }),
    ),
  };
  const simulator = new AgentSimulator({
    mode: { isActive: true, scenario },
    assets: stub(assets),
    references: stub(references),
  });
  return { simulator, assets, references };
}

function input(extra: Record<string, unknown> = {}): AgentPlanExecutionInput {
  return stub({
    userId: "u",
    agent: { connection: { id: "real" } },
    ...extra,
  });
}

const context = { runId: "run", stepId: "step" };

function content(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    asset,
    fileName: "x.txt",
    bytes: new Uint8Array([1, 2]),
    original: { mimeType: "text/plain", size: 2 },
    ...extra,
  };
}

describe("AgentSimulator local runner", () => {
  it("answers without a file and runs the start hook", async () => {
    const beforeStart = vi.fn(() => Promise.resolve());
    const { simulator } = build();
    const answer = await simulator.run(input({ beforeStart }), signal);
    expect(answer).toContain("lokal, Szenario ok");
    expect(answer).toContain("Keine Datei übergeben");
    expect(beforeStart).toHaveBeenCalledOnce();
  });

  it("writes a result file for a plan asset", async () => {
    const { simulator, assets } = build();
    const answer = await simulator.run(
      input({
        resourceContext: context,
        readTicketAssets: () => Promise.resolve([content()]),
      }),
      signal,
    );
    expect(answer).toContain("x.txt · text · text/plain · 2 Bytes");
    expect(answer).toContain(
      "- Ergebnis: ergebnis-x.txt (/agent-plan-assets/r1)",
    );
    expect(assets.storeResult).toHaveBeenCalledWith(
      "u",
      expect.objectContaining({ fileName: "ergebnis-x.txt", projectId: "p1" }),
    );
  });

  it("describes inputs without a result file", async () => {
    const { simulator } = build();
    const answer = await simulator.run(
      input({
        readTicketAssets: () =>
          Promise.resolve([
            content(),
            content({
              asset: { ...asset, source: "ticket" },
              original: undefined,
            }),
            content({
              bytes: undefined,
              original: { mimeType: "a/b", size: 9 },
            }),
            content({ bytes: undefined, original: undefined }),
          ]),
      }),
      signal,
    );
    expect(answer).toContain("(gelesen, keine Ergebnisdatei)");
    expect(answer).toContain("file · application/octet-stream · 2 Bytes");
    expect(answer).toContain("· 9 Bytes (als Originaldatei übergeben");
    expect(answer).toContain("· 0 Bytes (als Originaldatei übergeben");
  });

  it("describes a ticket input beside a missing resource context", async () => {
    const { simulator } = build();
    const answer = await simulator.run(
      input({ readTicketAssets: () => Promise.resolve([content()]) }),
      signal,
    );
    expect(answer).toContain("gelesen, keine Ergebnisdatei");
  });

  it("fails the defective file in the scenario item_failed", async () => {
    const { simulator } = build("item_failed");
    const run = (fileName: string): Promise<string> =>
      simulator.run(
        input({
          readTicketAssets: () => Promise.resolve([content({ fileName })]),
        }),
        signal,
      );
    await expect(run("Defekt.txt")).rejects.toBeInstanceOf(AgentAssetError);
    await expect(run("fein.txt")).resolves.toContain("item_failed");
  });

  it("waits in the scenario slow and stops when aborted", async () => {
    await build("slow").simulator.run(input(), signal);
    expect(delay).toHaveBeenCalledWith(5_000, undefined, { signal });
    const controller = new AbortController();
    controller.abort();
    await expect(
      build().simulator.run(input(), controller.signal),
    ).rejects.toThrow();
  });
});

describe("AgentSimulator remote runner", () => {
  const remote = {
    agent: { connection: { id: AGENT_SIMULATION_CONNECTIONS.remote } },
  };
  const ticketInputs = [
    { owner: "ticket", ticket: { title: "skip", assets: [asset] } },
    {
      owner: "asset",
      originals: { "plan:a1": "digest" },
      ticket: { title: "x.txt", assets: [asset] },
    },
    { owner: "asset", ticket: { title: "y.txt", assets: [asset] } },
  ];

  it("redeems one reference per file", async () => {
    const { simulator, references } = build();
    const answer = await simulator.run(
      input({ ...remote, ticketInputs, resourceContext: context }),
      signal,
    );
    expect(answer).toContain("Remote-Runner");
    expect(references.issue).toHaveBeenNthCalledWith(1, "u", {
      assetId: "a1",
      digest: "digest",
      runId: "run",
      stepId: "step",
    });
    expect(references.issue).toHaveBeenNthCalledWith(2, "u", {
      assetId: "a1",
      digest: "",
      runId: "run",
      stepId: "step",
    });
    expect(references.redeem).toHaveBeenCalledTimes(2);
  });

  it("works without ticket inputs and without a resource context", async () => {
    const { simulator, references } = build();
    expect(await simulator.run(input(remote), signal)).toContain("Keine Datei");
    await simulator.run(
      input({ ...remote, ticketInputs: [ticketInputs[1]] }),
      signal,
    );
    expect(references.issue).toHaveBeenCalledWith(
      "u",
      expect.objectContaining({ runId: "", stepId: "" }),
    );
  });

  it("measures a file beyond the in-memory budget", async () => {
    const { simulator, references } = build();
    references.redeem.mockResolvedValue({
      assetId: "a1",
      fileName: "big.bin",
      mediaType: "application/octet-stream",
      size: PLAN_HANDOVER_LIMITS.inlineBytes + 1,
      stream: Readable.from([Buffer.from("abc")]),
    });
    const answer = await simulator.run(
      input({ ...remote, ticketInputs: [ticketInputs[1]] }),
      signal,
    );
    expect(answer).toContain("als Originaldatei übergeben");
  });

  it("names the file of a refused reference", async () => {
    const { simulator, references } = build();
    references.redeem.mockRejectedValue(new AgentError("plan_asset_changed"));
    await expect(
      simulator.run(
        input({ ...remote, ticketInputs: [ticketInputs[1]] }),
        signal,
      ),
    ).rejects.toMatchObject({ code: "plan_asset_changed", fileName: "x.txt" });
    references.redeem.mockRejectedValue(new Error("boom"));
    await expect(
      simulator.run(
        input({ ...remote, ticketInputs: [ticketInputs[1]] }),
        signal,
      ),
    ).rejects.toThrow("boom");
  });
});
