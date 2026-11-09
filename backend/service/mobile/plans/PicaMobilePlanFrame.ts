import { PICA_MOBILE_MAXIMUM_PLANS_FRAME_LENGTH } from "@/definition/PicaMobileProtocol";

import { encodePicaMobilePlan } from "../PicaMobileMessages";
import { truncatePlanText } from "./PicaMobilePlanRows";

import type {
  PicaMobileFlowStage,
  PicaMobilePlanPayload,
  PicaMobilePlanRun,
} from "@/definition/PicaMobileProtocol";

/** The newest iterations per loop a `plan` keeps while it is still too long. */
const ITERATION_LIMITS: readonly number[] = [20, 5, 1, 0];

type StageChange = (stage: PicaMobileFlowStage) => PicaMobileFlowStage;

/** Applies a change to every stage of a flow, the stages of its loops included. */
function mapFlowStages(
  stages: readonly PicaMobileFlowStage[],
  change: StageChange,
): PicaMobileFlowStage[] {
  return stages.map((stage) => {
    const changed = change(stage);

    return {
      ...changed,
      nodes: changed.nodes.map((node) =>
        node.loop === undefined
          ? node
          : {
              ...node,
              loop: {
                ...node.loop,
                stages: mapFlowStages(node.loop.stages, change),
              },
            },
      ),
    };
  });
}

function withFlowStages(
  run: PicaMobilePlanRun,
  change: StageChange,
): PicaMobilePlanRun {
  return run.flow === undefined
    ? run
    : {
        ...run,
        flow: { ...run.flow, stages: mapFlowStages(run.flow.stages, change) },
      };
}

function shortenRun(run: PicaMobilePlanRun): PicaMobilePlanRun {
  return withFlowStages(
    {
      ...run,
      name: truncatePlanText(run.name),
      stages: run.stages.map((stage) => ({
        ...stage,
        steps: stage.steps.map((step) => ({
          ...step,
          name: truncatePlanText(step.name),
        })),
      })),
    },
    (stage) => ({
      ...stage,
      nodes: stage.nodes.map((node) =>
        node.name === undefined
          ? node
          : { ...node, name: truncatePlanText(node.name) },
      ),
    }),
  );
}

/** Keeps the newest iterations of every loop; `iterationCount` still names all of them. */
function limitIterations(
  run: PicaMobilePlanRun,
  limit: number,
): PicaMobilePlanRun {
  return withFlowStages(run, (stage) => ({
    ...stage,
    nodes: stage.nodes.map((node) =>
      node.loop === undefined
        ? node
        : {
            ...node,
            loop: {
              ...node.loop,
              iterations: limit === 0 ? [] : node.loop.iterations.slice(-limit),
            },
          },
    ),
  }));
}

/** The shorter forms of a run, the mildest first. */
function* shorterRuns(run: PicaMobilePlanRun): Generator<PicaMobilePlanRun> {
  const shortened = shortenRun(run);

  yield shortened;

  if (run.flow === undefined) return;

  for (const limit of ITERATION_LIMITS) yield limitIterations(shortened, limit);
}

/**
 * Builds the `plan` frame within the frame limit.
 *
 * @param requestId - Identifier of the `plan_get` that is answered.
 * @param payload - The answer.
 * @returns The frame; `null` when even the shortest form does not fit.
 *
 * @remarks
 * A frame that is too long first gets names of at most
 * 200 code units, then keeps only the newest 20, 5, 1 and finally no
 * iteration per loop. `iterationCount` keeps counting every iteration, so a
 * client can tell that older ones were left out.
 */
export function encodePlanWithinLimit(
  requestId: string,
  payload: PicaMobilePlanPayload,
): string | null {
  const frame = encodePicaMobilePlan(requestId, payload);

  if (frame.length <= PICA_MOBILE_MAXIMUM_PLANS_FRAME_LENGTH) {
    return frame;
  }

  if (payload.access === "gone" || payload.run === null) {
    return null;
  }

  for (const run of shorterRuns(payload.run)) {
    const shorter = encodePicaMobilePlan(requestId, { ...payload, run });

    if (shorter.length <= PICA_MOBILE_MAXIMUM_PLANS_FRAME_LENGTH) {
      return shorter;
    }
  }

  return null;
}
