export const DEFAULT_BLOCK_SIZE: number;
export const DEFAULT_MAX_OLD_SPACE_SIZE_MB: number;
export const LINT_PROCESS_CONCURRENCY: number;

/** Validated configuration for a sequential lint runner invocation. */
export interface LintConfig {
  readonly blockSize: number;
  readonly blockSizeSource: string;
  readonly maxOldSpaceSizeMb: number;
  readonly maxOldSpaceSizeSource: string;
  readonly concurrency: number;
  readonly changedOnly: boolean;
  readonly diffBase: string | null;
}

/** One sequential ESLint process and the files it checks. */
export interface LintBlock {
  readonly index: number;
  readonly total: number;
  readonly scope: "root";
  readonly files: readonly string[];
}

export function resolveLintConfig(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): LintConfig;

export function collectCandidateFiles(rootDir: string): readonly string[];

export function discoverLintFiles(rootDir: string): Promise<readonly string[]>;

export function discoverChangedLintFiles(
  rootDir: string,
  baseRef?: string | null,
): Promise<readonly string[]>;

export function buildLintBlocks(
  files: readonly string[],
  blockSize: number,
): readonly LintBlock[];
