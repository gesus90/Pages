declare module "@/scripts/runner/live.mjs" {
  interface LiveEvent {
    kind: string;
    text: string;
    channel: string;
    createdAt: string;
    isTruncated: boolean;
  }
  export function createLiveHistory(
    command: { program: { route: { tool: string } } },
    redact: (text: string) => string,
    emit: (event: LiveEvent) => Promise<void>,
  ): { receive(event: unknown): Promise<void>; finish(): Promise<void> };
  export function liveBatch<T extends { sequence: number }>(
    events: T[],
    after: number,
  ): T[];
}
