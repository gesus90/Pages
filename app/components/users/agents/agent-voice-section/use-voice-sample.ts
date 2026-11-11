import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { backendRequestHeaders } from "@/app/lib/backend-request";
import { VOICE_PLAYBACK_RATE_HEADER } from "@/definition/SpeechSynthesis";

import type { AgentVoiceSampleLanguage } from "@/definition/SpeechSynthesis";

/** One sample to hear: the voice and the speed; the text is fixed on the server. */
export interface VoiceSampleRequest {
  /** The voice to hear; `null` for the model's first voice. */
  readonly voiceId: string | null;
  readonly speedTenths: number;
}

/** What the player knows about the sample it plays. */
export interface VoiceSample {
  /** The voice whose sample plays or loads; `undefined` while nothing does. */
  readonly activeVoice: string | null | undefined;
  readonly isLoading: boolean;
  readonly isPlaying: boolean;
  /** How much of the sample has played, 0 to 1. */
  readonly progress: number;
  /** The length of the last sample in seconds at the speed heard; `null` before one loaded. */
  readonly durationSeconds: number | null;
  /** The error code of the last request, or `request` when it did not reach Pages. */
  readonly error: string | null;
  readonly toggle: (request: VoiceSampleRequest) => void;
}

interface LoadedSample {
  readonly url: string;
  readonly playbackRate: number;
}

function sampleKey(request: VoiceSampleRequest): string {
  return `${request.voiceId ?? ""}|${request.speedTenths}`;
}

function readPlaybackRate(response: Response): number {
  const rate = Number(response.headers.get(VOICE_PLAYBACK_RATE_HEADER));
  return Number.isFinite(rate) && rate >= 0.5 && rate <= 2 ? rate : 1;
}

async function readError(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
    )
      return payload.error;
  } catch (error: unknown) {
    console.warn("[pages] The voice sample answer could not be read.", error);
  }
  return "request";
}

async function requestSample(
  agentId: string,
  request: VoiceSampleRequest,
  language: AgentVoiceSampleLanguage,
): Promise<LoadedSample | string> {
  const response = await fetch(
    `/users-api/agent-voice/${encodeURIComponent(agentId)}`,
    {
      method: "POST",
      cache: "no-store",
      headers: backendRequestHeaders({
        Accept: "audio/*",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ ...request, language }),
    },
  );
  if (!response.ok) return readError(response);
  return {
    url: URL.createObjectURL(await response.blob()),
    playbackRate: readPlaybackRate(response),
  };
}

/** The audio element of the panel and the samples it already loaded. */
function useSampleAudio(): {
  readonly audio: React.RefObject<HTMLAudioElement | null>;
  readonly loaded: React.RefObject<Map<string, LoadedSample>>;
  readonly progress: number;
  readonly durationSeconds: number | null;
  readonly isPlaying: boolean;
} {
  const audio = useRef<HTMLAudioElement | null>(null);
  const loaded = useRef(new Map<string, LoadedSample>());
  const [progress, setProgress] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  useEffect(() => {
    const element = new Audio();
    audio.current = element;
    const samples = loaded.current;
    function handleTime(): void {
      setProgress(
        element.duration ? element.currentTime / element.duration : 0,
      );
    }
    function handleMeta(): void {
      setDurationSeconds(element.duration / element.playbackRate);
    }
    function handleState(): void {
      setIsPlaying(!element.paused && !element.ended);
    }
    element.addEventListener("timeupdate", handleTime);
    element.addEventListener("loadedmetadata", handleMeta);
    element.addEventListener("play", handleState);
    element.addEventListener("pause", handleState);
    element.addEventListener("ended", handleState);
    return () => {
      element.pause();
      for (const sample of samples.values()) URL.revokeObjectURL(sample.url);
      samples.clear();
    };
  }, []);
  return { audio, loaded, progress, durationSeconds, isPlaying };
}

/**
 * Loads and plays samples of an agent's voice (PAGE-300).
 *
 * @param agentId - The stored agent; `null` for an agent not yet created,
 * which has no sample.
 * @returns The player state and the toggle of one sample.
 *
 * @remarks
 * A sample is asked for once per voice and speed while the panel is open;
 * the server keeps equal samples for 24 hours as well. When the model
 * refused the speed, the player applies it itself.
 */
export function useVoiceSample(agentId: string | null): VoiceSample {
  const { i18n } = useTranslation();
  const player = useSampleAudio();
  const [active, setActive] = useState<VoiceSampleRequest | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const language: AgentVoiceSampleLanguage = i18n.language.startsWith("en")
    ? "en"
    : "de";

  async function play(request: VoiceSampleRequest): Promise<void> {
    const element = player.audio.current;
    if (agentId === null || element === null) return;
    const key = sampleKey(request);
    setActive(request);
    setError(null);
    let sample = player.loaded.current.get(key);
    if (sample === undefined) {
      setIsLoading(true);
      const answer = await requestSample(agentId, request, language).catch(
        () => "request",
      );
      setIsLoading(false);
      if (typeof answer === "string") {
        setError(answer);
        return;
      }
      sample = answer;
      player.loaded.current.set(key, sample);
    }
    element.src = sample.url;
    element.playbackRate = sample.playbackRate;
    element.defaultPlaybackRate = sample.playbackRate;
    await element.play();
  }

  function toggle(request: VoiceSampleRequest): void {
    const element = player.audio.current;
    if (
      element !== null &&
      player.isPlaying &&
      active !== undefined &&
      sampleKey(active) === sampleKey(request)
    ) {
      element.pause();
      return;
    }
    element?.pause();
    void play(request).catch((caught: unknown) => {
      console.warn("[pages] The voice sample could not be played.", caught);
      setError("playback");
    });
  }

  return {
    activeVoice: active?.voiceId,
    isLoading,
    isPlaying: player.isPlaying,
    progress: player.progress,
    durationSeconds: player.durationSeconds,
    error,
    toggle,
  };
}
