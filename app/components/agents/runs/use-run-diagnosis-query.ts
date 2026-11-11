import { useEffect, useState } from "react";

import { RUN_DIAGNOSIS_ENDPOINT } from "./run-diagnosis-model";

import type { RunDiagnosisAnswers } from "./run-diagnosis-model";

/** What a query of the run view has so far. */
export interface RunDiagnosisQuery<View extends keyof RunDiagnosisAnswers> {
  readonly data: RunDiagnosisAnswers[View] | null;
  readonly isLoading: boolean;
  readonly isFailed: boolean;
}

function readQuery(key: string): Record<string, string> {
  const parsed: unknown = JSON.parse(key);
  if (typeof parsed !== "object" || parsed === null) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/**
 * Reads one view of the run diagnosis again whenever its parameters change.
 *
 * @param view - Which answer to read.
 * @param parameters - The query; `null` reads nothing.
 * @param isValid - Narrows the untrusted answer.
 */
export function useRunDiagnosisQuery<View extends keyof RunDiagnosisAnswers>(
  view: View,
  parameters: Readonly<Record<string, string>> | null,
  isValid: (value: unknown) => value is RunDiagnosisAnswers[View],
): RunDiagnosisQuery<View> {
  const [state, setState] = useState<RunDiagnosisQuery<View>>({
    data: null,
    isLoading: parameters !== null,
    isFailed: false,
  });
  const key = parameters === null ? null : JSON.stringify(parameters);

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ view, ...readQuery(key) });
    setState((previous) => ({ ...previous, isLoading: true, isFailed: false }));
    void fetch(`${RUN_DIAGNOSIS_ENDPOINT}?${query.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok || !isValid(body)) throw new Error("run diagnosis");
        setState({ data: body, isLoading: false, isFailed: false });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState((previous) => ({
          ...previous,
          isLoading: false,
          isFailed: true,
        }));
      });
    return () => controller.abort();
  }, [key, view, isValid]);

  return state;
}
