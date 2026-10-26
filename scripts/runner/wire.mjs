/** Mirrors the authenticated Pages channel's existing per-message limit. */
export const MAXIMUM_RUNNER_PACKET_BYTES = 2 * 1024 * 1024;
/** Pending wire bytes stay bounded even when a peer stops reading but keeps its connection open. */
export const MAXIMUM_RUNNER_BUFFER_BYTES = 4 * 1024 * 1024;

/** Applies transport backpressure by closing/reconciling rather than queueing more unacknowledged copies. */
export function sendRunnerPacket(channel, message) {
  const packet = JSON.stringify(message);
  const bytes = Buffer.byteLength(packet);
  if (bytes > MAXIMUM_RUNNER_PACKET_BYTES)
    throw new Error("Runner message exceeds 2 MiB wire budget");
  if (channel.bufferedAmount + bytes > MAXIMUM_RUNNER_BUFFER_BYTES)
    throw new Error("Runner transport buffer full; reconciliation required");
  channel.send(packet);
}
