import { createHash } from "node:crypto";

/**
 * The key of one activation of a Jump node.
 * @param activation - Which start of the node in its run, counting from 1.
 * @param iteration - The iteration of the loop the node runs in; absent on the outer plane.
 * @remarks
 * A new iteration of a loop, or a new start of the node, is a new call; a
 * repeated or recovered dispatch of the same start is not.
 */
export function invocationActivationKey(
  activation: number,
  iteration?: number | null,
): string {
  return iteration === undefined || iteration === null
    ? `${activation}`
    : `${activation}:${iteration}`;
}

/**
 * The stable identity of a call.
 * @param sourceRunId - The calling run.
 * @param sourceNodeId - The Jump node.
 * @param activationKey - See {@link invocationActivationKey}.
 * @remarks
 * The identity is derived, not drawn: a dispatch that repeats after a crash
 * arrives at the same call. It is formatted like a UUID, which the other ids
 * of a run are, but a guess of it grants nothing: signals are checked against
 * the authenticated run that sends them.
 */
export function invocationId(
  sourceRunId: string,
  sourceNodeId: string,
  activationKey: string,
): string {
  const hex = createHash("sha256")
    .update(JSON.stringify([sourceRunId, sourceNodeId, activationKey]))
    .digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
