import { useEffect, useRef, useState } from "react";

import { downsample, encodeWave, VOICE_SAMPLE_RATE } from "./voice-audio";

/** A finished recording, ready to send. */
export interface VoiceRecording {
  readonly file: Blob;
  readonly durationMs: number;
}

/** What the recorder of the composer offers. */
export interface VoiceRecorder {
  readonly isRecording: boolean;
  /** Milliseconds recorded so far. */
  readonly elapsedMs: number;
  /** Asks for the microphone and starts; `false` when it is refused. */
  start(): Promise<boolean>;
  /** Ends the recording and hands it over. */
  stop(): void;
  /** Ends the recording and drops it. */
  cancel(): void;
}

/** The open microphone and the blocks recorded from it. */
interface RecordingSession {
  readonly stream: MediaStream;
  readonly context: AudioContext;
  readonly processor: ScriptProcessorNode;
  readonly blocks: Float32Array[];
  readonly startedAt: number;
}

const BLOCK_SAMPLES = 4096;
const TICK_MILLISECONDS = 250;

function close(session: RecordingSession): void {
  session.processor.disconnect();
  session.stream.getTracks().forEach((track) => track.stop());
  void session.context.close();
}

/**
 * Records from the microphone into a WAV file of 16 kHz mono (PAGE-277).
 *
 * @param maximumMs - The longest recording of Pages; it stops there by itself.
 * @param onRecorded - Receives every finished recording.
 * @returns The recorder.
 *
 * @remarks
 * The samples come from the Web Audio API and are written as WAV in the
 * page, so no format is converted and no library is needed.
 */
export function useVoiceRecorder(
  maximumMs: number,
  onRecorded: (recording: VoiceRecording) => void,
): VoiceRecorder {
  const session = useRef<RecordingSession | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isRecording, setRecording] = useState(false);
  const handler = useRef(onRecorded);
  handler.current = onRecorded;

  function finish(shouldKeep: boolean): void {
    const current = session.current;
    if (!current) return;
    session.current = null;
    close(current);
    setRecording(false);
    setElapsedMs(0);
    if (!shouldKeep) return;
    const samples = downsample(current.blocks, current.context.sampleRate);
    const durationMs = Math.min(
      maximumMs,
      Math.round((samples.length / VOICE_SAMPLE_RATE) * 1000),
    );
    if (durationMs < 1) return;
    handler.current({ file: encodeWave(samples), durationMs });
  }

  useEffect(() => {
    if (!isRecording) return undefined;
    const timer = window.setInterval(() => {
      const current = session.current;
      if (!current) return;
      const elapsed = performance.now() - current.startedAt;
      setElapsedMs(elapsed);
      if (elapsed >= maximumMs) finish(true);
    }, TICK_MILLISECONDS);
    return () => window.clearInterval(timer);
  });

  useEffect(
    () => () => {
      if (session.current) close(session.current);
    },
    [],
  );

  async function start(): Promise<boolean> {
    if (session.current) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(BLOCK_SAMPLES, 1, 1);
      const blocks: Float32Array[] = [];
      processor.onaudioprocess = (event) => {
        blocks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(context.destination);
      session.current = {
        stream,
        context,
        processor,
        blocks,
        startedAt: performance.now(),
      };
      setRecording(true);
      return true;
    } catch (error: unknown) {
      console.warn("The microphone could not be opened", error);
      return false;
    }
  }

  return {
    isRecording,
    elapsedMs,
    start,
    stop: () => finish(true),
    cancel: () => finish(false),
  };
}
