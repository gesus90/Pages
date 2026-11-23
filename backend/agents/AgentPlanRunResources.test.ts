import { describe, expect, it } from "vitest";

import {
  allRunAssetReferences,
  readPlanRunResources,
  readStoredTicketAsset,
} from "@/backend/agents/AgentPlanRunResources";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentTicketAsset } from "@/definition/AgentTicketParameter";

const ASSET: AgentTicketAsset = { source: "ticket", id: "a1", link: "l1" };

describe("readStoredTicketAsset", () => {
  it("reads every known source", () => {
    for (const source of ["ticket", "wiki", "agent", "plan"] as const)
      expect(readStoredTicketAsset({ source, id: " i ", link: "l" })).toEqual({
        source,
        id: "i",
        link: "l",
      });
  });

  it("rejects an unknown source", () => {
    expect(() =>
      readStoredTicketAsset({ source: "x", id: "i", link: "l" }),
    ).toThrow("Invalid stored ticket asset source");
  });
});

describe("readPlanRunResources", () => {
  it("reads a minimal snapshot", () => {
    expect(
      readPlanRunResources({ plan: { workspaceId: "w", projectId: "p" } }),
    ).toMatchObject({
      projectId: "p",
      workspaceIds: ["w"],
      taskIds: [],
      agentIds: [],
      connectionIds: [],
      ticketAssets: [],
      remoteWorkspaceIds: [],
    });
  });

  it("collects local resources", () => {
    const resources = readPlanRunResources({
      plan: {
        workspaceId: "w",
        projectId: "p",
        executionTarget: { kind: "remote", workspaceId: "rw" },
        nodes: [
          { type: "task", taskId: "t1" },
          { type: "agent", agentId: "ag" },
          { type: "agent", agentId: "x", configuration: { connectionId: "c" } },
          { type: "agent", agentId: "y", configuration: { runnerRoute: {} } },
          { type: "other" },
        ],
      },
      steps: [
        {
          step: { type: "agent", agentId: "ag2" },
          taskIds: ["t2"],
          prepared: {
            parameters: {
              assetInputs: [{ ticket: { assets: [ASSET] } }, { ticket: {} }],
              values: {
                a: null,
                b: { type: "workspace", workspaceId: "w2" },
                c: { type: "wiki", pageId: "wp" },
                d: { type: "ticket", ticketId: "tk" },
                e: { type: "text" },
              },
            },
          },
        },
        { prepared: {} },
      ],
    });
    expect(resources).toMatchObject({
      executionTarget: { kind: "remote", workspaceId: "rw" },
      workspaceIds: ["w", "w2"],
      taskIds: ["t1", "t2"],
      wikiIds: ["wp"],
      ticketIds: ["tk"],
      agentIds: ["ag", "ag2"],
      connectionIds: ["c"],
      ticketAssets: [ASSET],
    });
  });

  it("collects remote resources", () => {
    const resources = readPlanRunResources({
      plan: { workspaceId: "w", projectId: "p" },
      remoteSteps: [
        { target: { workspaceId: "r1" } },
        { target: { workspaceId: "r1" }, parameters: {} },
        {
          target: { workspaceId: "r1" },
          parameters: {
            workspaces: { r2: {} },
            tickets: { t9: {} },
            wiki: { w9: {} },
            assets: [
              { reference: { source: "wiki", id: "x", link: "l" } },
              { reference: { source: "ticket", id: "y", link: "l" } },
              { reference: { source: "agent", id: "z", link: "l" } },
              { reference: { source: "plan", id: "q", link: "l" } },
            ],
          },
        },
      ],
    });
    expect(resources.remoteWorkspaceIds).toEqual(["r1", "r2"]);
    expect(resources.ticketIds).toEqual(["t9"]);
    expect(resources.wikiIds).toEqual(["w9"]);
    expect(resources.ticketAssets).toHaveLength(4);
  });

  it("rejects an invalid remote asset", () => {
    expect(() =>
      readPlanRunResources({
        plan: { workspaceId: "w", projectId: "p" },
        remoteSteps: [
          {
            target: { workspaceId: "r" },
            parameters: { assets: [{ reference: { source: "x" } }] },
          },
        ],
      }),
    ).toThrow("Invalid remote asset");
  });
});

describe("allRunAssetReferences", () => {
  it("merges pinned assets with recorded downloads", () => {
    const wiki: AgentTicketAsset = { source: "wiki", id: "w", link: "l" };
    const run = {
      steps: [{ resourceAccess: { files: [{ asset: wiki }, {}] } }, {}],
    } as unknown as Pick<AgentPlanRun, "steps">;
    expect(allRunAssetReferences(run, [ASSET])).toEqual([ASSET, wiki]);
    expect(allRunAssetReferences({ steps: [] })).toEqual([]);
  });
});
