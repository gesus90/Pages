/** The two kinds of frames that count in budgets of their own. */
export type PicaMobileFrameKind = "message" | "voiceChunk";

interface BudgetLimit {
  /** Frames one rate window admits. */
  readonly perWindow: number;
  /** Frames that may wait for their turn at once. */
  readonly pending: number;
}

const RATE_WINDOW_MILLISECONDS = 10_000;

/** The requests whose frames may exceed 16 KiB, up to the size of `chat_send`. */
const LARGE_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  "chat_send",
  "conversation_send",
  "voice_chunk",
]);

/** Recognizes a `voice_chunk` frame before it is parsed, to count it in its own budget. */
const VOICE_CHUNK_TYPE = /"type"\s*:\s*"voice_chunk"/u;

/**
 * Voice chunks have their own budget: 160 chunks of 64 KB are 10 MB in ten
 * seconds, so a recording does not use up the limit of the other messages.
 */
const LIMITS: Readonly<Record<PicaMobileFrameKind, BudgetLimit>> = {
  message: { perWindow: 30, pending: 8 },
  voiceChunk: { perWindow: 160, pending: 64 },
};

/**
 * Tells the budget a text frame counts in before it is parsed.
 *
 * @param text - The frame.
 * @param isAuthenticated - Whether the connection is authenticated; before
 * that every frame is a message.
 * @returns `voiceChunk` for a frame that names `voice_chunk`.
 */
export function readPicaMobileFrameKind(
  text: string,
  isAuthenticated: boolean,
): PicaMobileFrameKind {
  return isAuthenticated && VOICE_CHUNK_TYPE.test(text)
    ? "voiceChunk"
    : "message";
}

/**
 * Checks a parsed message against the frame it came in.
 *
 * @param type - The type of the parsed message.
 * @param frame - Whether the frame exceeded 16 KiB and the budget it counted in.
 * @returns Why the frame is refused, or `null` when it fits its message.
 */
export function describePicaMobileFrameMismatch(
  type: string,
  frame: { readonly isLarge: boolean; readonly kind: PicaMobileFrameKind },
): string | null {
  if (frame.isLarge && !LARGE_MESSAGE_TYPES.has(type))
    return "Only chat_send, conversation_send and voice_chunk may exceed 16384 bytes.";
  if (frame.kind === "voiceChunk" && type !== "voice_chunk")
    return "A frame that names voice_chunk must be a voice_chunk.";
  return null;
}

/**
 * Counts the frames of one connection against its rate and queue limits.
 *
 * @remarks
 * Every frame counts in the window of ten seconds it arrives in, and as
 * pending until its handling ended. A peer that exceeds either limit loses
 * its connection.
 */
export class PicaMobileFrameBudget {
  private readonly now: () => number;
  private windowStart: number;
  private readonly inWindow: Record<PicaMobileFrameKind, number> = {
    message: 0,
    voiceChunk: 0,
  };
  private readonly waiting: Record<PicaMobileFrameKind, number> = {
    message: 0,
    voiceChunk: 0,
  };

  /**
   * Creates the budget.
   *
   * @param now - The clock of the connection in milliseconds.
   */
  public constructor(now: () => number) {
    this.now = now;
    this.windowStart = now();
  }

  /** Counts an arriving frame; tells whether it exceeds the rate of its kind. */
  public isOverRate(kind: PicaMobileFrameKind): boolean {
    const current = this.now();

    if (current - this.windowStart >= RATE_WINDOW_MILLISECONDS) {
      this.windowStart = current;
      this.inWindow.message = 0;
      this.inWindow.voiceChunk = 0;
    }

    this.inWindow[kind] += 1;

    return this.inWindow[kind] > LIMITS[kind].perWindow;
  }

  /** Tells whether no further frame of the kind may wait. */
  public isQueueFull(kind: PicaMobileFrameKind): boolean {
    return this.waiting[kind] >= LIMITS[kind].pending;
  }

  /** Notes that a frame starts or ends waiting for its handling. */
  public countPending(kind: PicaMobileFrameKind, change: 1 | -1): void {
    this.waiting[kind] += change;
  }
}
