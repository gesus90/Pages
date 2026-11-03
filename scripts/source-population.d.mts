export function isGeneratedDirectory(relativePath: string): boolean;

export function isSourceFile(relativePath: string): boolean;

export function isFingerprintedFile(relativePath: string): boolean;

export function walkFiles(
  rootDir: string,
  accept: (relativePath: string) => boolean,
): readonly string[];
