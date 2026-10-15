import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

interface PromptState {
  readonly text: string | null;
  readonly hasError: boolean;
}

/** Loads the pinned, authorized prompt on demand instead of guessing historical inputs from an edited plan. */
export function PlanRunInputs({
  runId,
  stepId,
  isAvailable,
}: {
  readonly runId: string;
  readonly stepId: string;
  readonly isAvailable: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [prompt, setPrompt] = useState<PromptState>({
    text: null,
    hasError: false,
  });
  const isLoading = attempt > 0 && prompt.text === null && !prompt.hasError;
  const url = `/agent-api/plan-runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/prompt`;
  useEffect(() => {
    if (attempt === 0) return undefined;
    const controller = new AbortController();
    async function load(): Promise<void> {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (
          !response.ok ||
          !response.headers.get("Content-Type")?.startsWith("text/plain")
        )
          throw new Error("prompt_unavailable");
        const text = await response.text();
        if (!controller.signal.aborted) setPrompt({ text, hasError: false });
      } catch {
        if (!controller.signal.aborted)
          setPrompt({ text: null, hasError: true });
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt, url]);
  function request(): void {
    setPrompt({ text: null, hasError: false });
    setAttempt(attempt + 1);
  }
  return (
    <section
      className="space-y-2"
      aria-busy={isLoading}
      aria-label={t("plans.details.inputs")}
    >
      <h4 className="text-sm font-semibold">{t("plans.details.inputs")}</h4>
      <p className="text-xs text-muted-foreground">
        {t("plans.details.inputsHint")}
      </p>
      {prompt.text === null ? (
        <Button
          size="sm"
          variant="outline"
          disabled={!isAvailable || isLoading}
          onClick={request}
        >
          {t(
            prompt.hasError
              ? "plans.details.retryInputs"
              : "plans.session.prompt",
          )}
        </Button>
      ) : (
        <pre className="pages-selectable max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap break-words">
          {prompt.text}
        </pre>
      )}
      {isLoading ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("plans.details.inputsLoading")}
        </p>
      ) : null}
      {prompt.hasError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("plans.details.inputsError")}
        </p>
      ) : null}
      {!isAvailable ? (
        <p className="text-xs text-muted-foreground">
          {t("plans.details.notStarted")}
        </p>
      ) : null}
    </section>
  );
}
