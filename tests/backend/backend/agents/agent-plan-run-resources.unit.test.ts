import { expect, it } from "vitest";

import {
  allRunAssetReferences,
  readPlanRunResources,
} from "@/backend/agents/AgentPlanRunResources";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { PlanRemoteFile } from "@/definition/AgentPlanRemoteAccess";

const DIGEST = "a".repeat(64);

const SNAPSHOT = {
  plan: {
    workspaceId: "w-plan",
    projectId: "project",
    executionTarget: { kind: "remote", workspaceId: "remote-target" },
    nodes: [
      { type: "task", taskId: "task-node" },
      { type: "agent", agentId: "agent-node" },
      {
        type: "agent",
        agentId: "ignored",
        configuration: { connectionId: "connection-node" },
      },
      { type: "agent", configuration: { runnerRoute: { tool: "codex" } } },
      { type: "start" },
    ],
  },
  steps: [
    {
      step: { id: "s1", type: "agent", agentId: "agent-step" },
      taskIds: ["task-step"],
      prepared: {
        parameters: {
          values: {
            empty: null,
            workspace: { type: "workspace", workspaceId: "w-value" },
            wiki: { type: "wiki", pageId: "wiki-value" },
            ticket: { type: "ticket", ticketId: "ticket-value" },
            text: { type: "text", text: "plain" },
          },
          assetInputs: [
            {
              ticket: {
                assets: [
                  { source: "ticket", id: "asset-1", link: "/a/1" },
                  { source: "ticket", id: "asset-1", link: "/a/1" },
                ],
              },
            },
            { ticket: {} },
          ],
        },
      },
    },
    { prepared: {} },
  ],
  remoteSteps: [
    {
      step: { id: "r1", type: "agent" },
      target: { workspaceId: "remote-step" },
      parameters: {
        workspaces: { "w-remote": {} },
        tickets: { "ticket-remote": {} },
        wiki: { "wiki-remote": {} },
        assets: [{ reference: { source: "wiki", id: "asset-2", link: "/b" } }],
      },
    },
    {
      step: { id: "r2", type: "script" },
      target: { workspaceId: "remote-script" },
      parameters: {},
    },
    {
      step: { id: "r3", type: "script" },
      target: { workspaceId: "remote-bare" },
    },
  ],
};

it("collects every resource identifier the run may disclose", () => {
  expect(readPlanRunResources(SNAPSHOT)).toEqual({
    stepTickets: {
      s1: ["task-step", "ticket-value"],
      r1: ["ticket-remote"],
    },
    remoteWorkspaceIds: [
      "remote-step",
      "w-remote",
      "remote-script",
      "remote-bare",
    ],
    executionTarget: { kind: "remote", workspaceId: "remote-target" },
    projectId: "project",
    workspaceIds: ["w-plan", "w-value"],
    taskIds: ["task-node", "task-step"],
    wikiIds: ["wiki-value", "wiki-remote"],
    ticketIds: ["ticket-value", "ticket-remote"],
    agentIds: ["agent-node", "agent-step"],
    connectionIds: ["connection-node"],
    ticketAssets: [
      { source: "ticket", id: "asset-1", link: "/a/1" },
      { source: "wiki", id: "asset-2", link: "/b" },
    ],
  });
});

it("reads a minimal snapshot as the Pages host without nodes or steps", () => {
  expect(
    readPlanRunResources({ plan: { workspaceId: "w", projectId: "p" } }),
  ).toEqual({
    stepTickets: {},
    remoteWorkspaceIds: [],
    projectId: "p",
    workspaceIds: ["w"],
    taskIds: [],
    wikiIds: [],
    ticketIds: [],
    agentIds: [],
    connectionIds: [],
    ticketAssets: [],
  });
});

it("refuses a stored asset of an unknown source", () => {
  const storedStep = {
    prepared: {
      parameters: {
        assetInputs: [{ ticket: { assets: [{ source: "disk", id: "x" }] } }],
      },
    },
  };
  expect(() =>
    readPlanRunResources({ ...SNAPSHOT, steps: [storedStep] }),
  ).toThrow("Invalid stored ticket asset source");
});

it("refuses a remote asset of an unknown source", () => {
  expect(() =>
    readPlanRunResources({
      ...SNAPSHOT,
      remoteSteps: [
        {
          target: { workspaceId: "r" },
          parameters: { assets: [{ reference: { source: "disk" } }] },
        },
      ],
    }),
  ).toThrow("Invalid remote asset");
});

function file(asset?: PlanRemoteFile["asset"]): PlanRemoteFile {
  return {
    parameter: "files",
    name: "file.txt",
    type: "text/plain",
    size: 1,
    digest: DIGEST,
    ...(asset ? { asset } : {}),
  };
}

function step(files?: readonly PlanRemoteFile[]): AgentPlanStepResult {
  return {
    id: "s",
    name: "Step",
    status: "succeeded",
    isBlocked: false,
    cancellation: "none",
    output: null,
    error: null,
    ...(files
      ? { resourceAccess: { files: [...files], pages: "closed", events: [] } }
      : {}),
  };
}

it("combines pinned assets with assets the run downloaded", () => {
  const pinned = { source: "ticket" as const, id: "a", link: "/pinned" };
  const downloaded = {
    source: "ticket" as const,
    id: "a",
    link: "/downloaded",
  };
  const agent = { source: "agent" as const, id: "b", link: "/agent" };
  expect(
    allRunAssetReferences(
      {
        steps: [step([file(downloaded), file()]), step(), step([file(agent)])],
      },
      [pinned],
    ),
  ).toEqual([downloaded, agent]);
  expect(allRunAssetReferences({ steps: [] })).toEqual([]);
});
