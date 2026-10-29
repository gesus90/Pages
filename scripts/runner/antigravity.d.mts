/** The metadata the runner reports for the Antigravity ACP tool of its host. */
export interface AntigravityInventory {
  readonly tool: "antigravity";
  readonly version: string | null;
  readonly authentication: "unknown" | "authenticated" | "not_logged_in";
  readonly models: readonly {
    readonly id: string;
    readonly name: string;
    readonly reasoningEfforts: readonly string[];
  }[];
  readonly acp: { readonly status: string; readonly reason: string };
  readonly catalogRevision?: string;
}

/** Queries only metadata from the execution host's isolated Antigravity context. */
export function antigravityInventory(
  base: Readonly<Record<string, string>>,
  context?: { readonly signal?: AbortSignal },
): Promise<AntigravityInventory>;
/** The error code of a failure the adapter reported as agent text, or `null`. */
export function antigravityTurnFailure(
  text: string,
  hasMcp: boolean,
): string | null;
/** Captures validated host ancestor identities for the worker's user namespace. */
export function antigravityContextProof(): Promise<string>;
/** Requires exact selector membership and confirmation before prompting. */
export function chooseAntigravity(
  client: { call(method: string, params: unknown): Promise<unknown> },
  sessionId: string,
  options: unknown,
  selection: {
    readonly id: string;
    readonly value: string;
    readonly error: string;
  },
): Promise<unknown>;
/** The native ACP worker command. */
export function antigravityCommand(): readonly string[];
/** A context isolated from the CLI's private Gemini home. */
export function antigravityEnvironment(
  base: Readonly<Record<string, string>>,
): Readonly<Record<string, string>>;

/** A frozen native assignment, with only the already-authorized Pages MCP bridge. */
export interface AntigravityJob {
  readonly workspace: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
  readonly access: "read_only" | "yolo";
  readonly mcpServers: readonly unknown[];
}

/** Executes through injectable process/filesystem boundaries used by the runner tests. */
export function executeAntigravity(
  job: AntigravityJob,
  prompt: string,
  base?: Readonly<Record<string, string>>,
): Promise<unknown>;
