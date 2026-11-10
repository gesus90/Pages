import { useEffect, useRef, useState } from "react";

import { encodeWav, joinSamples, resampleTo16k } from "./wav-recording";

/** Where a test recording stands. */
export type SpeechRecorderState = "idle" | "starting" | "recording";

/** A running recording of the microphone. */
interface ActiveRecording {
  readonly context: AudioContext;
  readonly stream: MediaStream;
  readonly processor: ScriptProcessorNode;
  readonly blocks: Float32Array[];
  readonly timer: number;
}

/** The test recording of the speech settings. */
export interface SpeechRecorder {
  readonly state: SpeechRecorderState;
  /** `true` when the browser gave no microphone. */
  readonly hasMicrophoneError: boolean;
  readonly start: () => Promise<void>;
  readonly stop: () => void;
}

const BLOCK_SIZE = 4096;

function release(recording: ActiveRecording): void {
  window.clearTimeout(recording.timer);
  recording.processor.disconnect();
  for (const track of recording.stream.getTracks()) track.stop();
  void recording.context.close();
}

/**
 * Records the microphone with the Web Audio API and hands over a WAV file.
 *
 * @param maximumMs - The recording stops by itself after this time.
 * @param onRecorded - Receives the finished recording as `audio/wav`.
 * @returns The state and the controls of the recording.
 *
 * @remarks
 * The samples stay in the browser until the recording ends; leaving the page
 * releases the microphone and drops them.
 */
export function useSpeechRecorder(
  maximumMs: number,
  onRecorded: (audio: Blob) => void,
): SpeechRecorder {
  const [state, setState] = useState<SpeechRecorderState>("idle");
  const [hasMicrophoneError, setMicrophoneError] = useState(false);
  const active = useRef<ActiveRecording | null>(null);
  const onRecordedRef = useRef(onRecorded);

  useEffect(() => {
    onRecordedRef.current = onRecorded;
  }, [onRecorded]);

  useEffect(
    () => () => {
      if (active.current) release(active.current);
      active.current = null;
    },
    [],
  );

  function stop(): void {
    const recording = active.current;
    if (!recording) return;
    active.current = null;
    release(recording);
    setState("idle");
    const samples = resampleTo16k(
      joinSamples(recording.blocks),
      recording.context.sampleRate,
    );
    recording.blocks.length = 0;
    onRecordedRef.current(encodeWav(samples));
  }

  async function start(): Promise<void> {
    if (active.current || state !== "idle") return;
    setMicrophoneError(false);
    setState("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setMicrophoneError(true);
      setState("idle");
      return;
    }
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(BLOCK_SIZE, 1, 1);
    const blocks: Float32Array[] = [];
    processor.onaudioprocess = (event) => {
      blocks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    source.connect(processor);
    processor.connect(context.destination);
    const timer = window.setTimeout(stop, maximumMs);
    active.current = { context, stream, processor, blocks, timer };
    setState("recording");
  }

  return { state, hasMicrophoneError, start, stop };
}
