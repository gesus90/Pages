import { createContext, useContext, useEffect, useRef, useState } from "react";

import type { ComponentProps, Dispatch, DragEvent, RefObject } from "react";

/** Receives the files a person dropped. */
type FileHandler = (files: File[]) => void;

/** The drag handlers of an element that takes dropped files. */
interface FileDropHandlers {
  onDragEnter(event: DragEvent): void;
  onDragOver(event: DragEvent): void;
  onDragLeave(event: DragEvent): void;
  onDrop(event: DragEvent): void;
}

/** An element that takes dropped files. */
export interface FileDrop {
  /** Whether files are being dragged over the element right now. */
  readonly isDragging: boolean;
  readonly handlers: FileDropHandlers;
}

/** What the drop zone of the conversation shares with the composer in it. */
interface DropZone {
  readonly isDragging: boolean;
  /** The composer's handler of dropped files. */
  readonly target: RefObject<FileHandler | null>;
  /** Tells the zone whether the composer takes files at all. */
  readonly setEnabled: Dispatch<boolean>;
}

const DropZoneContext = createContext<DropZone | null>(null);

/** Drops an inner element already took, so the zone around it adds nothing twice. */
const takenDrops = new WeakSet<Event>();

function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer.types.includes("Files");
}

/**
 * Lets an element take files dragged onto it (PAGE-298).
 *
 * @param onFiles - Receives the dropped files; `null` takes none.
 * @returns Whether files hover over the element, and its drag handlers.
 *
 * @remarks
 * Dragging over a child fires enter and leave again, so the hook counts
 * them. A drop an inner element took is not handed over a second time.
 */
export function useFileDrop(onFiles: FileHandler | null): FileDrop {
  const [isDragging, setDragging] = useState(false);
  const depth = useRef(0);

  function isMine(event: DragEvent): boolean {
    return onFiles !== null && carriesFiles(event);
  }

  function handleEnter(event: DragEvent): void {
    if (!isMine(event)) return;
    depth.current += 1;
    setDragging(true);
  }

  function handleOver(event: DragEvent): void {
    if (!isMine(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleLeave(event: DragEvent): void {
    if (!isMine(event)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  }

  function handleDrop(event: DragEvent): void {
    depth.current = 0;
    setDragging(false);
    if (onFiles === null || !carriesFiles(event)) return;
    event.preventDefault();
    if (takenDrops.has(event.nativeEvent)) return;
    takenDrops.add(event.nativeEvent);
    onFiles([...event.dataTransfer.files]);
  }

  return {
    isDragging,
    handlers: {
      onDragEnter: handleEnter,
      onDragOver: handleOver,
      onDragLeave: handleLeave,
      onDrop: handleDrop,
    },
  };
}

/**
 * Connects the composer with the drop zone of its conversation, so files
 * dropped anywhere on the conversation are attached.
 *
 * @param onFiles - Receives the dropped files; `null` while nothing can be attached.
 * @returns Whether files are being dragged over the conversation.
 */
export function usePageFileDrop(onFiles: FileHandler | null): boolean {
  const zone = useContext(DropZoneContext);
  const target = zone?.target;
  const setEnabled = zone?.setEnabled;
  const isEnabled = onFiles !== null;

  useEffect(() => {
    if (target) target.current = onFiles;
  });

  useEffect(() => {
    if (!setEnabled) return undefined;
    setEnabled(isEnabled);
    return () => setEnabled(false);
  }, [setEnabled, isEnabled]);

  return isEnabled && zone?.isDragging === true;
}

/**
 * The section of the opened conversation; files dropped anywhere on it go to
 * the composer at its foot (PAGE-298).
 */
export function ChatPageDropZone({
  children,
  ...properties
}: ComponentProps<"section">): React.ReactElement {
  const target = useRef<FileHandler | null>(null);
  const [isEnabled, setEnabled] = useState(false);
  const drop = useFileDrop(
    isEnabled ? (files) => target.current?.(files) : null,
  );
  return (
    <DropZoneContext
      value={{ isDragging: drop.isDragging, target, setEnabled }}
    >
      <section {...properties} {...drop.handlers}>
        {children}
      </section>
    </DropZoneContext>
  );
}
