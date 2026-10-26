import type { ChildProcess } from "node:child_process";
/** The runner's bounded OpenCode ACP adapter; its process and stream boundaries are injectable. */
export class OpenCodeAcpClient {
  constructor(
    child: ChildProcess,
    decide: (options: readonly unknown[]) => unknown,
    publish?: (event: unknown) => Promise<void>,
  );
  /** The newest native message, bounded to 1 MiB. */
  get text(): string;
  /** Publishes a complete message to the public projection. */
  flushMessage(): Promise<void>;
  /** Sends one native ACP request and waits for its bounded response. */
  call(method: string, params: unknown): Promise<unknown>;
}
