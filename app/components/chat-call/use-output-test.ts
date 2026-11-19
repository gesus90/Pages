import { useEffect, useRef, useState } from "react";

import { routeToOutput } from "./audio-devices";

/** The sample rate of the test tone, in hertz. */
const SAMPLE_RATE = 24_000;

/** How long the test tone lasts, in seconds. */
const TONE_SECONDS = 1.4;

/** The two notes of the test tone, in hertz. */
const NOTES = [523.25, 659.25] as const;

/** The peak of the tone; a test tone must not startle. */
const TONE_VOLUME = 0.22;

function writeText(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1)
    view.setUint8(offset + index, text.charCodeAt(index));
}

/** Builds a short two-note chime as a 16-bit mono WAV file. */
function createToneFile(): Blob {
  const count = Math.floor(SAMPLE_RATE * TONE_SECONDS);
  const view = new DataView(new ArrayBuffer(44 + count * 2));
  writeText(view, 0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  writeText(view, 8, "WAVE");
  writeText(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(view, 36, "data");
  view.setUint32(40, count * 2, true);
  for (let index = 0; index < count; index += 1) {
    const seconds = index / SAMPLE_RATE;
    const [first, second] = NOTES;
    const note = seconds < TONE_SECONDS / 2 ? first : second;
    // A short fade in and out avoids clicks at the edges of each note.
    const position = (seconds % (TONE_SECONDS / 2)) / (TONE_SECONDS / 2);
    const envelope = Math.sin(Math.PI * position) ** 0.5;
    const sample = Math.sin(2 * Math.PI * note * seconds) * envelope;
    view.setInt16(44 + index * 2, sample * TONE_VOLUME * 32_767, true);
  }
  return new Blob([view], { type: "audio/wav" });
}

/** The test tone of the loudspeaker: whether it plays and how to start it. */
export interface OutputTest {
  readonly isPlaying: boolean;
  /** Whether the chosen output was missing, so the tone ran over the system output. */
  readonly usedSystemOutput: boolean;
  readonly play: () => void;
}

interface PlayingTone {
  readonly element: HTMLAudioElement;
  readonly address: string;
}

function releaseTone(playing: React.RefObject<PlayingTone | null>): void {
  const tone = playing.current;
  playing.current = null;
  if (tone === null) return;
  tone.element.pause();
  tone.element.removeAttribute("src");
  URL.revokeObjectURL(tone.address);
}

/**
 * Plays the test tone on the chosen loudspeaker.
 * @remarks
 * The tone ends by itself. Where the browser cannot choose an output, or the
 * chosen one is gone, it runs over the output of the system. It stops with the
 * dialog.
 * @param deviceId - The chosen loudspeaker, `""` for the system output.
 */
export function useOutputTest(deviceId: string): OutputTest {
  const [isPlaying, setIsPlaying] = useState(false);
  const [usedSystemOutput, setUsedSystemOutput] = useState(false);
  const playing = useRef<PlayingTone | null>(null);

  useEffect(
    () => () => {
      releaseTone(playing);
    },
    [],
  );

  async function begin(): Promise<void> {
    releaseTone(playing);
    const address = URL.createObjectURL(createToneFile());
    const element = new Audio(address);
    const tone: PlayingTone = { element, address };
    playing.current = tone;
    const isRouted = await routeToOutput(element, deviceId);
    // The dialog closed or another tone started while the output was set.
    if (playing.current !== tone) return;
    setUsedSystemOutput(deviceId !== "" && !isRouted);
    element.addEventListener("ended", () => {
      if (playing.current !== tone) return;
      releaseTone(playing);
      setIsPlaying(false);
    });
    try {
      await element.play();
      if (playing.current === tone) setIsPlaying(true);
    } catch (error: unknown) {
      console.warn("Pages could not play the test tone.", error);
      if (playing.current === tone) releaseTone(playing);
      setIsPlaying(false);
    }
  }

  return { isPlaying, usedSystemOutput, play: () => void begin() };
}
