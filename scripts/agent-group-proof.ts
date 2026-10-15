/**
 * Practical provider proof outside the unit suites. Uses transient definitions and
 * in-memory plan storage, the real scheduler, binder, acceptance and Codex ACP adapter.
 * Run with --data, --connection, --workspace, --model, --effort and --output.
 * No Pages server or ticket tools are connected. Credentials stay in --data.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import { CliLocator } from "@/backend/agents/cli/CliLocator";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { CliSessionExecution } from "@/backend/agents/cli/CliSessionExecution";
import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";

import { prepareGroupProof } from "./agent-group-proof-setup";

import type { GroupProofOptions } from "./agent-group-proof-setup";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanRun } from "@/definition/AgentPlan";

function readOptions(): GroupProofOptions {
  const { values } = parseArgs({
    options: {
      data: { type: "string" },
      connection: { type: "string" },
      workspace: { type: "string" },
      model: { type: "string" },
      effort: { type: "string", default: "low" },
      output: { type: "string" },
    },
  });
  if (
    !values.data ||
    !values.connection ||
    !values.workspace ||
    !values.model ||
    !values.output
  )
    throw new Error(
      "--data, --connection, --workspace, --model and --output are required",
    );
  return {
    credentialData: path.resolve(values.data),
    connectionId: values.connection,
    workspace: path.resolve(values.workspace),
    model: values.model,
    effort: values.effort,
    output: path.resolve(values.output),
  };
}

function proofExecution(options: GroupProofOptions): CliSessionExecution {
  const store = new AgentCredentialStore(options.credentialData);
  const locator = new CliLocator();
  const runner = new CliProcessRunner();
  return new CliSessionExecution({
    store,
    locator,
    runner,
    runtime: new AgentCliRuntime({ store, locator, runner }),
  });
}

async function runProof(options: GroupProofOptions): Promise<void> {
  const { plan, snapshot, start } = await prepareGroupProof(options);
  const execution = proofExecution(options);
  const inputs = new Map<string, string>();
  const stored = new Map<string, AgentPlanRun>();
  const steps = new AgentPlanStepRunner({
    start,
    execution: {
      open: (input, signal, observer) =>
        execution.open(input, signal, observer),
      run: async (): Promise<never> => {
        throw new Error("No API provider in this proof");
      },
    },
    tasks: {
      checklist: async (): Promise<never> => {
        throw new Error("No ticket access in this proof");
      },
    },
    access: { grant: async () => null, revoke: async () => 0 },
    archive: {
      input: async (runId, stepId, prompt) => {
        inputs.set(stepId, prompt);
      },
    },
  });
  const engine = new AgentPlanRunEngine({
    runs: {
      create: async (run) => {
        stored.set(run.id, structuredClone(run));
      },
      insert: async (): Promise<never> => {
        throw new Error("No database in this proof");
      },
      update: async (run) => {
        stored.set(run.id, structuredClone(run));
      },
      find: async (id) => stored.get(id) ?? null,
    },
    start,
    steps,
  });
  let run: AgentPlanRun | undefined;
  try {
    const initial = await engine.start("proof", snapshot);
    const deadline = Date.now() + 300_000;
    while (stored.get(initial.id)?.status === "running") {
      if (Date.now() > deadline)
        throw new Error("Practical proof exceeded five minutes");
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 250);
      });
    }
    run = stored.get(initial.id);
    await mkdir(options.output, { recursive: true });
    const evidence = proofEvidence(run, inputs);
    await writeFile(
      path.join(options.output, "example-plan.json"),
      JSON.stringify(plan, null, 2) + "\n",
    );
    await writeFile(
      path.join(options.output, "native-session-proof.json"),
      JSON.stringify(
        {
          recordedAt: new Date().toISOString(),
          environment: {
            model: options.model,
            effort: options.effort,
            provider: "codex_cli",
            mode: "read_only",
            storage:
              "transient in-memory plan and definitions; real Codex ACP process; no Pages MCP",
          },
          evidence,
          run,
          sentPrompts: Object.fromEntries(inputs),
        },
        null,
        2,
      ) + "\n",
    );
    console.info(JSON.stringify(evidence));
    if (!Object.values(evidence).every(Boolean))
      throw new Error(
        "Practical proof did not meet every assertion; inspect native-session-proof.json",
      );
  } finally {
    await engine.shutdown();
  }
}

function proofEvidence(
  run: AgentPlanRun | undefined,
  inputs: ReadonlyMap<string, string>,
): Readonly<Record<string, boolean>> {
  const first = run?.steps.find((step) => step.id === "agent-1");
  const second = run?.steps.find((step) => step.id === "agent-2");
  return {
    planSucceeded: run?.status === "succeeded",
    ...sessionEvidence(first, second),
    ...contextEvidence(first?.output ?? "", second?.output ?? "", inputs),
    outerSuccessorSucceeded:
      run?.steps.find((step) => step.id === "end")?.status === "succeeded",
  };
}

function sessionEvidence(
  first: AgentPlanStepResult | undefined,
  second: AgentPlanStepResult | undefined,
): Readonly<Record<string, boolean>> {
  const previous = first?.session;
  const current = second?.session;
  if (!previous || !current)
    return {
      sameNativeSession: false,
      sameProcessInstance: false,
      confirmedCloseout: false,
    };
  return {
    sameNativeSession: Boolean(
      previous.sessionId && previous.sessionId === current.sessionId,
    ),
    sameProcessInstance: previous.instanceId === current.instanceId,
    confirmedCloseout:
      previous.closeout === "confirmed" && current.closeout === "confirmed",
  };
}

function contextEvidence(
  first: string,
  second: string,
  inputs: ReadonlyMap<string, string>,
): Readonly<Record<string, boolean>> {
  const nonce = first.match(/FIRST:([a-f0-9]{20})\|shared=page73-common/u)?.[1];
  const expected = nonce?.split("").reverse().join("");
  const secondInput = inputs.get("agent-2") ?? "";
  return {
    contextUsedWithNewInstruction: Boolean(
      expected &&
      second.includes(`SECOND:${expected}|shared=page73-common`) &&
      !second.includes("FIRST:"),
    ),
    nonceAbsentFromSecondInput: Boolean(nonce && !secondInput.includes(nonce)),
    commonParameterInBothInputs:
      inputs.size === 2 &&
      [...inputs.values()].every((prompt) =>
        prompt.includes("Shared text parameter: page73-common"),
      ),
  };
}

try {
  await runProof(readOptions());
} catch (error: unknown) {
  console.error(
    error instanceof Error ? error.message : "Practical proof failed",
  );
  process.exitCode = 1;
}
