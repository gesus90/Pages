/** Native content blocks derived from verified originals, or the unmodified prompt without assets. */
export function modelAssetContent(
  folder: string,
  prompt: string,
  supportsImages: boolean | undefined,
): Promise<string | readonly Readonly<Record<string, unknown>>[]>;
