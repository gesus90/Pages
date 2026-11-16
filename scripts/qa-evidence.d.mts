/** The sorted manifest of a scope and its SHA-256. */
export interface EvidenceManifest {
  readonly fingerprint: string;
  readonly manifest: string;
  readonly fileCount: number;
}

export function buildManifest(
  files: readonly string[],
  readHash: (file: string) => string | null,
  runtime: Readonly<Record<string, string>>,
): EvidenceManifest;

export function inspectDependencies(input: {
  readonly lockfile: string | null;
  readonly installedLockfile: string | null;
  readonly state: {
    readonly settings?: { readonly enableGlobalVirtualStore?: boolean };
  } | null;
}): readonly string[];

export function currentManifest(
  root: string,
  scope: "pages",
  listTracked?: (root: string) => readonly string[],
): EvidenceManifest;
