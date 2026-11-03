/** Exit code of a step that ran into its time limit. */
export const TIMEOUT_EXIT_CODE: number;

/** Exit code of a run whose browser or setup could not be provided. */
export const SETUP_EXIT_CODE: number;

/** What the inspection of one browser cache found. */
export interface BrowserCache {
  readonly directory: string;
  readonly usable: boolean;
  readonly reason: string | null;
}

export function browserCacheCandidates(
  environment: NodeJS.ProcessEnv,
  realHome: string,
): readonly string[];

export function privateBrowserCache(
  environment: NodeJS.ProcessEnv,
  realHome: string,
): string;

export function resultsDirectory(
  environment: NodeJS.ProcessEnv,
  realHome: string,
  repositoryRoot: string,
  now: Date,
): string;

export function requestedPort(environment: NodeJS.ProcessEnv): number | null;

export function timeoutMilliseconds(environment: NodeJS.ProcessEnv): number;

export function inspectBrowserCache(
  directory: string,
  revision: string,
  probe?: (file: string) => string | null,
): BrowserCache;

export function runStep(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly timeoutMilliseconds: number;
  },
): Promise<number>;

export function createRunDirectory(directory: string): Promise<string>;
