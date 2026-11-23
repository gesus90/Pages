import { describe, expect, it, vi } from "vitest";

import {
  createLocalSessionLaunch,
  localClosedSchema,
  localCommandSchema,
  localJournalAcknowledgementSchema,
  localJournalRecordSchema,
  localLaunchSchema,
  localMutationSchema,
  localOwnerManifestSchema,
  localOwnerProofSchema,
  localTurnSchema,
  restoredLocalMcp,
} from "@/backend/agents/local/LocalSessionContracts";

import type * as AgentErrors from "@/backend/error/AgentErrors";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";

vi.mock("@/backend/error/AgentErrors", async (importOriginal) => {
  const original = await importOriginal<typeof AgentErrors>();
  const messages = { ...original.AGENT_ERROR_MESSAGES };
  Object.defineProperty(messages, "hidden_code", {
    value: "hidden",
    enumerable: false,
  });
  return { ...original, AGENT_ERROR_MESSAGES: messages };
});

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const HEX64 = "a".repeat(64);

const baseInput: AgentPlanExecutionInput = {
  agent: {
    connection: {
      isActive: true,
      id: ID,
      name: "connection",
      provider: "openai",
      hasApiKey: false,
      testModel: null,
      reasoningEffort: null,
      cliLoggedInAt: null,
      cliAccountLabel: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    model: "model",
    reasoningEffort: null,
  },
  userId: ID,
  prompt: "do it",
  directory: null,
  recording: {
    key: { planId: ID, runId: ID, stepId: "step", attemptId: OTHER_ID },
    userId: ID,
    provider: "codex_cli",
    instanceId: ID,
    groupId: null,
    directory: null,
  },
};

function launchPayload(): Record<string, unknown> {
  return {
    runId: ID,
    stepId: "step",
    sessionScopeId: "scope",
    attemptId: ID,
    turnId: ID,
    isInstruction: false,
    instanceId: ID,
    userId: ID,
    prompt: "p",
    instruction: "",
    resumeSessionId: null,
    timeoutMinutes: 5,
    mcp: null,
  };
}

describe("createLocalSessionLaunch", () => {
  it("builds a plain launch from the recording", () => {
    const launch = createLocalSessionLaunch(baseInput, ID, null, 10);
    expect(launch).toEqual({
      runId: ID,
      stepId: "step",
      sessionScopeId: "step",
      attemptId: OTHER_ID,
      turnId: OTHER_ID,
      isInstruction: false,
      instanceId: ID,
      userId: ID,
      prompt: "do it",
      instruction: "",
      mcp: null,
      timeoutMinutes: 10,
      resumeSessionId: null,
    });
  });

  it("creates a fresh turn for a local instruction and keeps the scope, instruction, tools and resume session", () => {
    const resumed = {
      ...baseInput,
      acceptanceInstruction: "accept",
      resourceContext: {
        runId: ID,
        stepId: "step",
        sessionScopeId: "scope",
        isLocalInstruction: true,
      },
      resumeSessionId: "resume",
    };
    const launch = createLocalSessionLaunch(
      resumed,
      ID,
      { url: "http://bridge", tools: ["a", "b"] },
      3,
    );
    expect(launch.isInstruction).toBe(true);
    expect(launch.turnId).not.toBe(OTHER_ID);
    expect(launch.sessionScopeId).toBe("scope");
    expect(launch.instruction).toBe("accept");
    expect(launch.mcp).toEqual({ url: "http://bridge", tools: ["a", "b"] });
    expect(launch.resumeSessionId).toBe("resume");
  });

  it("keeps an unrestricted tool list", () => {
    const launch = createLocalSessionLaunch(
      baseInput,
      ID,
      { url: "http://bridge", tools: null },
      3,
    );
    expect(launch.mcp).toEqual({ url: "http://bridge", tools: null });
  });

  it("rejects a missing recording or one of another instance", () => {
    const { recording, ...withoutRecording } = baseInput;
    expect(recording).toBeDefined();
    expect(() =>
      createLocalSessionLaunch(withoutRecording, ID, null, 1),
    ).toThrow("changed");
    expect(() =>
      createLocalSessionLaunch(baseInput, OTHER_ID, null, 1),
    ).toThrow("changed");
  });

  it("rejects a launch that fails validation", () => {
    expect(() => createLocalSessionLaunch(baseInput, ID, null, -1)).toThrow(
      "launch",
    );
  });
});

describe("restoredLocalMcp", () => {
  it("returns null without tool access", () => {
    expect(restoredLocalMcp(localLaunchSchema.parse(launchPayload()))).toBe(
      null,
    );
  });

  it("returns the address with an empty bearer", () => {
    const launch = localLaunchSchema.parse({
      ...launchPayload(),
      mcp: { url: "http://bridge", tools: null },
    });
    expect(restoredLocalMcp(launch)).toEqual({
      url: "http://bridge",
      tools: null,
      token: "",
    });
  });
});

describe("schemas", () => {
  it("accepts a manifest and a proof", () => {
    expect(
      localOwnerManifestSchema.safeParse({
        version: 1,
        instanceKey: HEX64,
        capability: HEX64,
        configPath: "/c",
        directory: "/d",
        unit: `pages-local-${ID}.service`,
        launch: launchPayload(),
      }).success,
    ).toBe(true);
    expect(
      localOwnerProofSchema.safeParse({
        instanceKey: "k",
        instanceId: ID,
        runId: ID,
        stepId: "s",
        attemptId: ID,
        unit: "u",
        invocationId: "b".repeat(32),
        boot: ID,
        uid: 1,
        pid: 2,
        start: 3,
        cgroup: "/c",
        arguments: [],
      }).success,
    ).toBe(true);
  });

  it("validates agent error codes of a turn result", () => {
    const turn = {
      output: "",
      sessionId: null,
      failure: null,
      endedAt: "now",
      permissionDenials: 0,
      effective: {},
      events: [],
    };
    expect(
      localTurnSchema.parse({ ...turn, errorCode: "plan_context_changed" })
        .errorCode,
    ).toBe("plan_context_changed");
    expect(localTurnSchema.parse({ ...turn, errorCode: null }).errorCode).toBe(
      null,
    );
    expect(
      localTurnSchema.safeParse({ ...turn, errorCode: "unknown_code" }).success,
    ).toBe(false);
    expect(() =>
      localTurnSchema.parse({ ...turn, errorCode: "hidden_code" }),
    ).toThrow("Invalid agent error code");
  });
});

describe("journal and command schemas", () => {
  it("parses closeout, mutations, journal and commands", () => {
    expect(
      localClosedSchema.parse({
        exit: null,
        endedAt: "now",
        leftovers: 0,
        isConfirmed: true,
      }).isConfirmed,
    ).toBe(true);
    expect(
      localMutationSchema.parse({
        kind: "started",
        details: {
          mode: "one_shot",
          processId: null,
          startedAt: "now",
          arguments: [],
          unattended: "yes",
          namespace: { pid: 1, uid: 0, start: 2, boot: ID },
        },
      }).kind,
    ).toBe("started");
    expect(
      localMutationSchema.safeParse({ kind: "closed", result: {} }).success,
    ).toBe(false);
    const header = { sequence: 1, previousDigest: "", digest: HEX64 };
    expect(
      localJournalRecordSchema.safeParse({ ...header, payload: "{}" }).success,
    ).toBe(true);
    expect(
      localJournalRecordSchema.safeParse({ ...header, content: "x" }).success,
    ).toBe(true);
    expect(
      localJournalRecordSchema.safeParse({
        ...header,
        content: "x".repeat(4097),
      }).success,
    ).toBe(false);
    expect(
      localJournalAcknowledgementSchema.safeParse({
        sequence: 1,
        digest: HEX64,
      }).success,
    ).toBe(true);
    expect(localCommandSchema.parse({ kind: "cancel" }).kind).toBe("cancel");
    expect(
      localCommandSchema.safeParse({ kind: "bearer", token: "short" }).success,
    ).toBe(false);
  });
});
