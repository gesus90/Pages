/**
 * The one playback of the chat page: which video or sound plays,
 * where each one stopped, and the hand-over between the views of the same
 * file.
 * @remarks
 * A video can be shown at once in its card, in the split view and in the
 * full screen; each view has its own element. The store keeps the position
 * per attachment, so a view that opens continues where the last one was, and
 * a view that takes over pauses the others and plays on when they played.
 * When the playing view closes, the newest remaining view of the same file
 * continues, unless a new view opened in the same moment, as when the split
 * view or the full screen changes to another video. Starting any medium pauses every other one, so only one plays.
 */

/** One registered `<video>` or `<audio>` element of a player. */
export interface MediaHandle {
  readonly attachmentId: string;
  /** The element; `null` once it is gone. */
  readonly element: () => HTMLMediaElement | null;
  /** Mount order; a later view is preferred for the hand-back. */
  readonly order: number;
  /** Whether the element plays, as its events last said. */
  isPlaying: boolean;
}

/** Where a view starts: the position and whether the file played. */
export interface MediaHandover {
  readonly positionSeconds: number;
  readonly isPlaying: boolean;
}

const handles = new Set<MediaHandle>();
/** Hand-backs that wait for the closing view to be gone; a new view cancels them. */
const pendingHandBacks = new Set<{ isCancelled: boolean }>();
/**
 * Files whose playing view just closed; a view of the same file opened in
 * the same moment plays on, as when the full screen changes to "Daneben".
 */
const justPlaying = new Set<string>();
const positions = new Map<string, number>();
let mounted = 0;

/**
 * Registers the element of a player.
 * @param attachmentId - The file it plays.
 * @param element - Reads the element.
 */
export function registerMedia(
  attachmentId: string,
  element: () => HTMLMediaElement | null,
): MediaHandle {
  mounted += 1;
  const handle: MediaHandle = {
    attachmentId,
    element,
    order: mounted,
    isPlaying: false,
  };
  handles.add(handle);
  return handle;
}

/** The position a file stopped at; 0 for one never played. */
export function positionOf(attachmentId: string): number {
  return positions.get(attachmentId) ?? 0;
}

/** Remembers where a file is. */
export function savePosition(attachmentId: string, seconds: number): void {
  if (Number.isFinite(seconds) && seconds >= 0)
    positions.set(attachmentId, seconds);
}

/**
 * Marks a handle as playing and pauses every other playing element, of any
 * file: only one medium plays at a time.
 */
export function claimPlayback(handle: MediaHandle): void {
  handle.isPlaying = true;
  for (const other of handles) {
    if (other === handle || !other.isPlaying) continue;
    other.isPlaying = false;
    other.element()?.pause();
  }
}

/** Marks a handle as no longer playing. */
export function releasePlayback(handle: MediaHandle): void {
  handle.isPlaying = false;
}

/**
 * A new view takes the file over: the other views of the same file pause,
 * and the new one starts at their position, playing when they played.
 * @param handle - The new view.
 */
export function takeOver(handle: MediaHandle): MediaHandover {
  for (const pending of pendingHandBacks) pending.isCancelled = true;
  pendingHandBacks.clear();
  let isPlaying = justPlaying.delete(handle.attachmentId);
  for (const other of handles) {
    if (other === handle || other.attachmentId !== handle.attachmentId)
      continue;
    const element = other.element();
    if (element) savePosition(handle.attachmentId, element.currentTime);
    if (!other.isPlaying) continue;
    isPlaying = true;
    other.isPlaying = false;
    element?.pause();
  }
  return { positionSeconds: positionOf(handle.attachmentId), isPlaying };
}

/**
 * Removes a view. When it played, the newest remaining view of the same file
 * that is still on the page continues at its position.
 * @param handle - The view that closes.
 * @param schedule - Runs the hand-back after the closing view is gone; tests
 * pass a direct one.
 */
export function unregisterMedia(
  handle: MediaHandle,
  schedule: (task: () => void) => void = (task) => {
    window.setTimeout(task, 0);
  },
): void {
  handles.delete(handle);
  const element = handle.element();
  if (element) savePosition(handle.attachmentId, element.currentTime);
  if (!handle.isPlaying) return;
  handle.isPlaying = false;
  const pending = { isCancelled: false };
  pendingHandBacks.add(pending);
  justPlaying.add(handle.attachmentId);
  schedule(() => {
    pendingHandBacks.delete(pending);
    justPlaying.delete(handle.attachmentId);
    if (pending.isCancelled) return;
    const next = [...handles]
      .filter(
        (other) =>
          other.attachmentId === handle.attachmentId &&
          other.element()?.isConnected === true,
      )
      .sort((left, right) => right.order - left.order)[0];
    const target = next?.element();
    if (!next || !target) return;
    target.currentTime = positionOf(handle.attachmentId);
    void target.play().catch(() => undefined);
  });
}

/** Forgets every handle and position; for tests. */
export function resetMediaSession(): void {
  handles.clear();
  positions.clear();
  pendingHandBacks.clear();
  justPlaying.clear();
  mounted = 0;
}
