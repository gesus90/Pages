import { useEffect, useRef, useState } from "react";

import {
  MicrophoneError,
  openMicrophone,
  releaseStream,
} from "./audio-devices";

import type { MicrophoneFailure } from "./audio-devices";

/** Where the test of the microphone stands. */
export type MicrophoneTestStatus =
  "idle" | "starting" | "running" | "lost" | MicrophoneFailure;

/** The test of the chosen microphone: its status, the level it hears and how to start and end it. */
export interface MicrophoneTest {
  readonly status: MicrophoneTestStatus;
  /** What the microphone hears right now, from 0 to 1. */
  readonly level: number;
  /** Whether the test heard a voice since it started. */
  readonly hasHeard: boolean;
  readonly start: () => void;
  readonly stop: () => void;
}

/** The loudness from which a sound counts as a voice. */
const HEARD_LEVEL = 0.08;

/** How far a change of the level has to reach before the bar draws again. */
const LEVEL_STEP = 0.02;

/** The factor that makes a speaking voice fill most of the bar. */
const LEVEL_GAIN = 5;

interface RunningTest {
  readonly stream: MediaStream;
  readonly context: AudioContext;
  frame: number;
}

function releaseTest(running: React.RefObject<RunningTest | null>): void {
  const test = running.current;
  running.current = null;
  if (test === null) return;
  cancelAnimationFrame(test.frame);
  test.context.close().catch((error: unknown) => {
    console.warn("Pages could not close the level meter.", error);
  });
  releaseStream(test.stream);
}

function createMeter(stream: MediaStream): {
  readonly context: AudioContext;
  readonly analyser: AnalyserNode;
} {
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  return { context, analyser };
}

function rootMeanSquare(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

/**
 * Measures the level of the chosen microphone for the dialog.
 * @remarks
 * Opening the microphone is the only moment the browser asks for permission.
 * "Test beenden", a closed dialog and a lost device release the microphone
 * and the level meter.
 * @param deviceId - The chosen microphone, `""` for the system default.
 * @param onOpened - Called once the microphone is open, when the browser
 * lists the devices with their names.
 */
export function useMicrophoneTest(
  deviceId: string,
  onOpened: () => void,
): MicrophoneTest {
  const [status, setStatus] = useState<MicrophoneTestStatus>("idle");
  const [level, setLevel] = useState(0);
  const [hasHeard, setHasHeard] = useState(false);
  const running = useRef<RunningTest | null>(null);
  const attempt = useRef(0);

  useEffect(
    () => () => {
      attempt.current += 1;
      releaseTest(running);
    },
    [],
  );

  function stop(): void {
    attempt.current += 1;
    releaseTest(running);
    setStatus("idle");
    setLevel(0);
  }

  function measure(test: RunningTest, analyser: AnalyserNode): void {
    const samples = new Float32Array(analyser.fftSize);
    let shown = 0;
    function tick(): void {
      analyser.getFloatTimeDomainData(samples);
      const next = Math.min(1, rootMeanSquare(samples) * LEVEL_GAIN);
      const smoothed = Math.max(next, shown * 0.85);
      if (Math.abs(smoothed - shown) >= LEVEL_STEP || smoothed === 0) {
        shown = smoothed;
        setLevel(smoothed);
      }
      if (smoothed >= HEARD_LEVEL) setHasHeard(true);
      test.frame = requestAnimationFrame(tick);
    }
    test.frame = requestAnimationFrame(tick);
  }

  async function begin(): Promise<void> {
    attempt.current += 1;
    const mine = attempt.current;
    releaseTest(running);
    setStatus("starting");
    setHasHeard(false);
    setLevel(0);
    let stream: MediaStream;
    try {
      stream = await openMicrophone(deviceId);
    } catch (error: unknown) {
      if (mine !== attempt.current) return;
      setStatus(
        error instanceof MicrophoneError ? error.failure : "unavailable",
      );
      return;
    }
    if (mine !== attempt.current) {
      releaseStream(stream);
      return;
    }
    let meter: { context: AudioContext; analyser: AnalyserNode };
    try {
      meter = createMeter(stream);
    } catch (error: unknown) {
      console.warn("Pages could not start the level meter.", error);
      releaseStream(stream);
      setStatus("unavailable");
      return;
    }
    const { context, analyser } = meter;
    const test: RunningTest = { stream, context, frame: 0 };
    running.current = test;
    for (const track of stream.getAudioTracks())
      track.addEventListener("ended", () => {
        if (running.current !== test) return;
        releaseTest(running);
        setStatus("lost");
        setLevel(0);
      });
    setStatus("running");
    measure(test, analyser);
    onOpened();
  }

  return {
    status,
    level,
    hasHeard,
    start: () => void begin(),
    stop,
  };
}
