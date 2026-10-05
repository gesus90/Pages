import { useRef, useState } from "react";

/** The avatar image a user picked but did not save yet. */
export interface AvatarSelection {
  /** The picked file, or `null` while nothing is picked. */
  readonly file: File | null;
  /** A temporary address that previews the picked file. */
  readonly previewUrl: string | null;
  /** Attach this to the hidden file input that opens the picker. */
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  /** Picks a file and previews it; replaces an earlier pick. */
  readonly select: (file: File) => void;
  /** Forgets the pick and releases its preview. */
  readonly clear: () => void;
}

/** Keeps the picked avatar file together with its preview address. */
export function useAvatarSelection(): AvatarSelection {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function releasePreview(): void {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
  }

  function select(nextFile: File): void {
    releasePreview();
    setFile(nextFile);
    setPreviewUrl(URL.createObjectURL(nextFile));
  }

  function clear(): void {
    releasePreview();
    setFile(null);
    setPreviewUrl(null);
  }

  return { clear, file, inputRef, previewUrl, select };
}
