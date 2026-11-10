/** Native content blocks derived from verified originals, or the unmodified prompt without assets. */
export function modelAssetContent(
  folder: string,
  prompt: string,
  supportsImages: boolean | undefined,
): Promise<string | readonly Readonly<Record<string, unknown>>[]>;

/** Stable preparation code of an error, or the generic Pages MCP outage code. */
export function pagesFailure(error: unknown): string;

/** One request over the private socket; rejects with a stable `code` on refusal. */
export function pagesRequest(
  socketPath: string,
  jobId: string,
  request: Readonly<Record<string, unknown>>,
): Promise<unknown>;

/** Wakes the transport after a durable terminal result; never rejects. */
export function notifyJobCompletion(
  directory: string,
  jobId: string,
): Promise<void>;

/** Serves the private socket of a directory and returns the function that stops it. */
export function startPagesRelay(
  directory: string,
  request: (jobId: string, body: unknown) => Promise<unknown>,
): Promise<() => Promise<void>>;

/** Downloads and verifies the parameter files of a step and extends its prompt. */
export function preparePagesFiles<
  Command extends {
    readonly program: { readonly kind: string; readonly prompt: string };
    readonly workspace: string;
  },
>(
  command: Command,
  folder: string,
  jobId: string,
  signal: AbortSignal,
): Promise<Command>;

/** Removes only the run-created asset directory of a step. */
export function cleanupPagesFiles(folder: string): Promise<void>;
