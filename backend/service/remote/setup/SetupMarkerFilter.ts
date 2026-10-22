import { SETUP_PHASES } from "@/definition/RemoteSetup";

const MARKER_STATES = [
  "running",
  "waiting",
  "done",
  "failed",
  "skipped",
] as const;
const INTRODUCER = "\u001b]777;pages-setup;";
const TERMINATOR = "\u0007";
const MAXIMUM_MARKER = 96;
const BODY = new RegExp(
  `^phase=([1-${SETUP_PHASES.length}]);state=(${MARKER_STATES.join("|")});step=([a-z_]{0,32})$`,
  "u",
);

type MarkerState = (typeof MARKER_STATES)[number];

/** A progress report of the setup script, read from its terminal output. */
export interface SetupMarker {
  /** One-based phase number. */
  readonly phase: number;
  readonly state: MarkerState;
  /** What the script waits for or reports, for example `pairing`; may be empty. */
  readonly step: string;
}

/** The longest end of `text` that could still become the introducer. */
function partialIntroducer(text: string): number {
  const longest = Math.min(text.length, INTRODUCER.length - 1);
  for (let length = longest; length > 0; length -= 1)
    if (INTRODUCER.startsWith(text.slice(text.length - length))) return length;
  return 0;
}

function parseMarker(body: string): SetupMarker | null {
  const match = BODY.exec(body);
  if (!match) return null;
  const [, phase, state, step] = match;
  const markerState = MARKER_STATES.find((candidate) => candidate === state);
  if (phase === undefined || markerState === undefined || step === undefined)
    return null;
  return { phase: Number(phase), state: markerState, step };
}

/**
 * Separates the progress markers of the setup script from the text a person reads.
 *
 * @remarks
 * A marker is a private terminal sequence that no terminal draws. Output of
 * the machine is data: a marker only reports progress, and everything it
 * can cause is decided by the conductor and the server's own checks.
 * Sequences split across chunks are held back until they are complete.
 */
export class SetupMarkerFilter {
  private pending = "";

  /**
   * Takes the next chunk of terminal output.
   *
   * @param chunk - Raw output.
   * @returns The visible text and the complete markers in the chunk.
   */
  public feed(chunk: string): {
    readonly text: string;
    readonly markers: readonly SetupMarker[];
  } {
    let rest = this.pending + chunk;
    this.pending = "";
    let text = "";
    const markers: SetupMarker[] = [];
    while (rest !== "") {
      const start = rest.indexOf(INTRODUCER);
      if (start < 0) {
        const held = partialIntroducer(rest);
        text += rest.slice(0, rest.length - held);
        this.pending = rest.slice(rest.length - held);
        break;
      }
      text += rest.slice(0, start);
      const end = rest.indexOf(TERMINATOR, start);
      if (end < 0 && rest.length - start <= MAXIMUM_MARKER) {
        this.pending = rest.slice(start);
        break;
      }
      if (end < 0 || end - start > MAXIMUM_MARKER) {
        // Not a marker after all: show the text instead of swallowing output.
        text += INTRODUCER;
        rest = rest.slice(start + INTRODUCER.length);
        continue;
      }
      const marker = parseMarker(rest.slice(start + INTRODUCER.length, end));
      if (marker) markers.push(marker);
      rest = rest.slice(end + TERMINATOR.length);
    }
    return { text, markers };
  }
}
