import { planStackParticipants } from "@/definition/AgentPlanStackOutcome";
import { planStacks } from "@/definition/AgentPlanStack";

import type {
  AgentPlanInput,
  AgentPlanRun,
  AgentPlanStepActivation,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanAssetFile } from "@/definition/AgentPlanAsset";
import type { AgentPlanStackDelivery } from "@/definition/AgentPlanStack";

/** Where the work on one entry stands. */
export type PlanEntryState = "waiting" | "running" | "done" | "failed";

/** The result file a node wrote for one entry, named by its stable address. */
export interface PlanEntryResultFile {
  readonly assetId: string;
  readonly fileName: string;
}

/** One row of the overview: an input, how far it got and what came of it. */
export interface PlanEntryResult {
  readonly entryId: string;
  readonly position: number;
  readonly file: AgentPlanAssetFile;
  readonly state: PlanEntryState;
  /** The error code of the failed node, with the file it names. */
  readonly error: string | null;
  readonly resultFile: PlanEntryResultFile | null;
  /** The first line of the answer when no result file was written. */
  readonly summary: string | null;
}

/** The overview of one stack whose entries are files. */
export interface PlanEntryResults {
  readonly stackId: string;
  readonly name: string;
  readonly rows: readonly PlanEntryResult[];
}

type ResultLike = Pick<
  AgentPlanStepResult | AgentPlanStepActivation,
  "status" | "output" | "error"
>;

const RESULT_LINK =
  /- Ergebnis: (?<name>[^\n]+?) \(\/agent-plan-assets\/(?<id>[\w-]+)\)/gu;

/**
 * The result file a node names in its answer for one input, as the simulation writes it.
 *
 * @remarks
 * A node that received several files names one result per file; the one
 * called `ergebnis-<input>` belongs to the entry, else the first one.
 */
function resultFileOf(
  output: string | null,
  input: AgentPlanAssetFile,
): PlanEntryResultFile | null {
  const found = [...(output ?? "").matchAll(RESULT_LINK)].flatMap((match) => {
    const assetId = match.groups?.id;
    const fileName = match.groups?.name;
    return assetId && fileName ? [{ assetId, fileName }] : [];
  });
  return (
    found.find((entry) => entry.fileName === `ergebnis-${input.fileName}`) ??
    found[0] ??
    null
  );
}

function stateOf(results: readonly ResultLike[]): PlanEntryState {
  if (results.some((result) => result.status === "failed")) return "failed";
  if (results.length > 0 && results.every((r) => r.status === "succeeded"))
    return "done";
  return results.some((result) => result.status === "running")
    ? "running"
    : "waiting";
}

/** What the participants did with one delivery: in its loop iteration, or in the outer graph. */
function deliveryResults(
  run: AgentPlanRun,
  delivery: AgentPlanStackDelivery,
  participants: readonly string[],
): readonly ResultLike[] {
  if (delivery.loopId !== null) {
    const iteration = run.loops
      ?.find((loop) => loop.id === delivery.loopId)
      ?.iterations.find((entry) => entry.number === delivery.iteration);
    return (iteration?.nodes ?? []).filter((node) =>
      participants.includes(node.id),
    );
  }
  return participants.flatMap((id): readonly ResultLike[] => {
    const step = run.steps.find((entry) => entry.id === id);
    if (!step) return [];
    // The n-th handover started the participant for the n-th time.
    const activation = step.activation ?? 1;
    if (activation === delivery.position) return [step];
    return (step.history ?? []).filter(
      (entry) => entry.activation === delivery.position,
    );
  });
}

function rowOf(
  run: AgentPlanRun,
  entry: { readonly id: string; readonly file: AgentPlanAssetFile },
  context: {
    readonly position: number;
    readonly deliveries: readonly AgentPlanStackDelivery[];
    readonly participants: readonly string[];
  },
): PlanEntryResult {
  const delivery = context.deliveries.find((item) => item.entryId === entry.id);
  const results = delivery
    ? deliveryResults(run, delivery, context.participants)
    : [];
  const state = delivery ? stateOf(results) : "waiting";
  const output =
    results.find((result) => result.status === "succeeded")?.output ?? null;
  const resultFile = resultFileOf(output, entry.file);
  return {
    entryId: entry.id,
    position: context.position,
    file: entry.file,
    state: delivery && state === "waiting" ? "running" : state,
    error: results.find((result) => result.error)?.error ?? null,
    resultFile,
    summary: resultFile
      ? null
      : (output?.split("\n")[0]?.slice(0, 200) ?? null),
  };
}

/**
 * Assigns every file entry of every stack its status and result in one run.
 *
 * @param plan - The plan the run executed.
 * @param run - The shown run.
 * @returns One overview per stack that holds at least one file.
 */
export function planEntryResults(
  plan: AgentPlanInput,
  run: AgentPlanRun,
): readonly PlanEntryResults[] {
  return planStacks(plan).flatMap((stack): readonly PlanEntryResults[] => {
    const files = stack.entries.flatMap((entry, index) =>
      entry.type === "asset" ? [{ entry, position: index + 1 }] : [],
    );
    if (files.length === 0) return [];
    const deliveries =
      run.stacks?.find((record) => record.id === stack.id)?.deliveries ?? [];
    const participants = planStackParticipants(plan, stack.id);
    return [
      {
        stackId: stack.id,
        name: stack.name,
        rows: files.map(({ entry, position }) =>
          rowOf(run, entry, { position, deliveries, participants }),
        ),
      },
    ];
  });
}
