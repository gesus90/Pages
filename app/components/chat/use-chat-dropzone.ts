import { useEffect, useRef, useState } from "react";

import type { DragEvent } from "react";

/** Handlers of the drop area and whether a file is dragged over it. */
export interface ChatDropzone {
  readonly isActive: boolean;
  readonly handlers: {
    readonly onDragEnter: (event: DragEvent<HTMLElement>) => void;
    readonly onDragOver: (event: DragEvent<HTMLElement>) => void;
    readonly onDragLeave: (event: DragEvent<HTMLElement>) => void;
    readonly onDrop: (event: DragEvent<HTMLElement>) => void;
  };
}

interface ChatDropzoneOptions {
  readonly isOpen: boolean;
  readonly canDrop: boolean;
  /** Receives the dropped files and the names of dropped folders, which are not read. */
  readonly onFiles: (
    files: readonly File[],
    folders: readonly string[],
  ) => void;
}

/** Only a drag that carries files opens the drop area; text and elements drag as before. */
function isFileDrag(transfer: DataTransfer | null): boolean {
  return transfer !== null && [...transfer.types].includes("Files");
}

/** The dropped files; a folder is named and left out, its content is never read. */
function droppedFiles(transfer: DataTransfer): {
  readonly files: File[];
  readonly folders: string[];
} {
  const files: File[] = [];
  const folders: string[] = [];
  for (const item of [...transfer.items]) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry();
    if (entry?.isDirectory) {
      folders.push(entry.name);
      continue;
    }
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (files.length === 0 && folders.length === 0) files.push(...transfer.files);
  return { files, folders };
}

/**
 * Drag-and-drop of files onto the chat (PAGE-92).
 *
 * @remarks
 * A file drag over the panel shows the drop area; the drop goes the same way
 * as the "+" button. While the panel is open, a file dropped elsewhere on the
 * page is not opened by the browser instead of Pages, unless another drop
 * target of Pages takes it. Drags of text or of elements stay untouched.
 */
export function useChatDropzone({
  isOpen,
  canDrop,
  onFiles,
}: ChatDropzoneOptions): ChatDropzone {
  const [isActive, setIsActive] = useState(false);
  // Entering a child fires before leaving its parent, so the depth tells when the drag left the panel.
  const depth = useRef(0);

  useEffect(() => {
    if (!isOpen) return undefined;
    function guard(event: globalThis.DragEvent): void {
      if (isFileDrag(event.dataTransfer) && !event.defaultPrevented)
        event.preventDefault();
    }
    function reset(): void {
      depth.current = 0;
      setIsActive(false);
    }
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    window.addEventListener("dragend", reset);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
      window.removeEventListener("dragend", reset);
    };
  }, [isOpen]);

  return {
    isActive,
    handlers: {
      onDragEnter(event) {
        if (!isFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        depth.current += 1;
        setIsActive(true);
      },
      onDragOver(event) {
        if (!isFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = canDrop ? "copy" : "none";
      },
      onDragLeave(event) {
        if (!isFileDrag(event.dataTransfer)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setIsActive(false);
      },
      onDrop(event) {
        if (!isFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        depth.current = 0;
        setIsActive(false);
        if (!canDrop) return;
        const { files, folders } = droppedFiles(event.dataTransfer);
        onFiles(files, folders);
      },
    },
  };
}
