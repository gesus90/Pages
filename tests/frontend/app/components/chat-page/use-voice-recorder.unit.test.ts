import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useVoiceRecorder } from "@/app/components/chat-page/use-voice-recorder";

import type { VoiceRecording } from "@/app/components/chat-page/use-voice-recorder";

const stopTrack = vi.fn();
const disconnect = vi.fn();
const closeContext = vi.fn().mockResolvedValue(undefined);
let processAudio:
  | ((event: { inputBuffer: { getChannelData: () => Float32Array } }) => void)
  | null = null;

class FakeAudioContext {
  public readonly sampleRate = 16000;
  public readonly destination = {};

  /** Connects the microphone source to the processor. */
  public createMediaStreamSource(): { connect: () => void } {
    return { connect: vi.fn() };
  }

  /** Captures the callback used to supply recorded samples. */
  public createScriptProcessor(): {
    connect: () => void;
    disconnect: typeof disconnect;
    onaudioprocess: typeof processAudio;
  } {
    return {
      connect: vi.fn(),
      disconnect,
      get onaudioprocess() {
        return processAudio;
      },
      set onaudioprocess(callback) {
        processAudio = callback;
      },
    };
  }

  /** Releases the simulated audio context. */
  public close(): Promise<void> {
    return closeContext();
  }
}

function installMicrophone(): void {
  stopTrack.mockClear();
  disconnect.mockClear();
  closeContext.mockClear();
  processAudio = null;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: {
      getUserMedia: vi
        .fn()
        .mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }),
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("records samples as a WAV and releases the microphone on stop", async () => {
  installMicrophone();
  const onRecorded = vi.fn<(recording: VoiceRecording) => void>();
  const { result } = renderHook(() => useVoiceRecorder(5000, onRecorded));
  await act(async () => expect(await result.current.start()).toBe(true));
  expect(result.current.isRecording).toBe(true);
  act(() => {
    processAudio?.({
      inputBuffer: { getChannelData: () => new Float32Array(1600) },
    });
    result.current.stop();
  });
  expect(onRecorded).toHaveBeenCalledOnce();
  expect(onRecorded.mock.calls[0][0].durationMs).toBe(100);
  expect(onRecorded.mock.calls[0][0].file).toBeInstanceOf(Blob);
  expect(result.current.isRecording).toBe(false);
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(closeContext).toHaveBeenCalledOnce();
});

it("cancels without sending and closes an active recording on unmount", async () => {
  installMicrophone();
  const onRecorded = vi.fn<(recording: VoiceRecording) => void>();
  const { result, unmount } = renderHook(() =>
    useVoiceRecorder(5000, onRecorded),
  );
  await act(async () => {
    await result.current.start();
  });
  act(() => result.current.cancel());
  expect(onRecorded).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.start();
  });
  unmount();
  expect(stopTrack).toHaveBeenCalledTimes(2);
});

it("reports a refused microphone request", async () => {
  installMicrophone();
  vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(
    new Error("denied"),
  );
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const { result } = renderHook(() => useVoiceRecorder(5000, vi.fn()));
  await act(async () => expect(await result.current.start()).toBe(false));
  expect(result.current.isRecording).toBe(false);
  expect(warning).toHaveBeenCalledOnce();
});

it("stops automatically at the maximum duration", async () => {
  installMicrophone();
  vi.useFakeTimers();
  const onRecorded = vi.fn<(recording: VoiceRecording) => void>();
  const { result } = renderHook(() => useVoiceRecorder(250, onRecorded));
  await act(async () => {
    await result.current.start();
  });
  act(() => {
    processAudio?.({
      inputBuffer: { getChannelData: () => new Float32Array(8000) },
    });
    vi.advanceTimersByTime(250);
  });
  expect(onRecorded.mock.calls[0][0].durationMs).toBe(250);
  expect(result.current.isRecording).toBe(false);
});
