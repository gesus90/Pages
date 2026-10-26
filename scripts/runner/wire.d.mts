export const MAXIMUM_RUNNER_PACKET_BYTES: number;
export const MAXIMUM_RUNNER_BUFFER_BYTES: number;
/** A bounded outbound websocket boundary; socket ownership stays with the runner transport. */
export interface RunnerWireSocket {
  readonly bufferedAmount: number;
  send(packet: string): void;
}
/** Sends only a bounded frame when the websocket's pending byte budget permits it. */
export function sendRunnerPacket(
  channel: RunnerWireSocket,
  message: unknown,
): void;
