import { useTranslation } from "react-i18next";

import { formatSeconds } from "./live-answer-state";

interface ChatAnswerDurationProps {
  readonly durationMs: number;
}

/** Shows the elapsed time for the whole agent answer. */
export function ChatAnswerDuration({
  durationMs,
}: ChatAnswerDurationProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  return (
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
      {t("chatPage.liveAnswer.totalDuration", {
        duration: formatSeconds(durationMs, i18n.language),
      })}
    </span>
  );
}
