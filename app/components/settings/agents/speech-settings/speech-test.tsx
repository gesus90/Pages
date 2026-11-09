import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { useSpeechRecorder } from "./use-speech-recorder";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { SpeechTestOutcome } from "@/definition/SpeechRecognition";

/** A test recording is short; it never exceeds the limit that applies either. */
const TEST_MAXIMUM_MS = 15_000;

/** What the test button shows. */
export type SpeechTestPhase = "idle" | "starting" | "recording" | "sending";

/** The test recording of the speech settings: record, send, show the text. */
export interface SpeechTest {
  readonly phase: SpeechTestPhase;
  /** Whether the button cannot be used right now, while the microphone opens or the text is awaited. */
  readonly isBusy: boolean;
  readonly toggle: () => Promise<void>;
  readonly outcome: SpeechTestOutcome | null;
  readonly hasMicrophoneError: boolean;
  /** Whether the server could not be asked at all. */
  readonly hasRequestError: boolean;
}

/**
 * Records a short test from the microphone and lets Pages recognize it.
 *
 * @param effectiveMaxDurationMs - The longest recording that applies now.
 * @returns The state and the control of the test.
 */
export function useSpeechTest(effectiveMaxDurationMs: number): SpeechTest {
  const fetcher = useFetcher<AgentActionResult>({ key: "speech-test" });
  const recorder = useSpeechRecorder(
    Math.min(TEST_MAXIMUM_MS, effectiveMaxDurationMs),
    handleRecorded,
  );
  const isSending = fetcher.state !== "idle";

  function handleRecorded(audio: Blob): void {
    const form = new FormData();
    form.set("intent", "test-speech");
    form.set("audio", audio, "test.wav");
    void fetcher.submit(form, {
      method: "post",
      encType: "multipart/form-data",
    });
  }

  async function toggle(): Promise<void> {
    if (recorder.state === "recording") {
      recorder.stop();
      return;
    }
    await recorder.start();
  }

  const result = fetcher.data;
  return {
    phase: isSending ? "sending" : recorder.state,
    isBusy: isSending || recorder.state === "starting",
    toggle,
    outcome: !isSending && result?.ok ? (result.speech ?? null) : null,
    hasMicrophoneError: recorder.hasMicrophoneError,
    hasRequestError: !isSending && result?.ok === false,
  };
}

/** The recognized text of a test recording, or why there is none. */
export function SpeechTestResult({
  test,
}: {
  readonly test: SpeechTest;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (test.hasMicrophoneError)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("speechSettings.microphoneError")}
      </p>
    );
  if (test.hasRequestError)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("speechSettings.testError.request")}
      </p>
    );
  const { outcome } = test;
  if (outcome === null) return null;
  if (!outcome.ok)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t(`speechSettings.testError.${outcome.code}`)}
      </p>
    );
  return (
    <div
      role="status"
      className="rounded-lg border border-border bg-muted px-3 py-2 text-sm"
    >
      <span className="text-muted-foreground">
        {t("speechSettings.recognized")}
      </span>{" "}
      <span className="font-medium text-foreground">
        {outcome.text || t("speechSettings.recognizedEmpty")}
      </span>
    </div>
  );
}
