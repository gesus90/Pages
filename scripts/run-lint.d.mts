/** One sequential ESLint process and the files it checks. */
export interface LintBlock {
  readonly index: number;
  readonly total: number;
  readonly scope: "root";
  readonly files: readonly string[];
}

export function collectCandidateFiles(rootDir: string): readonly string[];

export function discoverLintFiles(rootDir: string): Promise<readonly string[]>;

export function buildLintBlocks(
  files: readonly string[],
  blockSize: number,
): readonly LintBlock[];
