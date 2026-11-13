import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import { CONVERSATION_ROUND_LIMITS_RANGE } from "@/definition/ConversationObserver";

import type { ConversationRoundLimits } from "@/definition/ConversationObserver";

/** The bounded number of contributions without @ per round (PAGE-349); @ hand-overs are not limited. */
export function ChatPageRoundLimits({
  limits,
  isDisabled,
  onChange,
}: {
  readonly limits: ConversationRoundLimits;
  readonly isDisabled: boolean;
  readonly onChange: (limits: ConversationRoundLimits) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fields = [
    {
      key: "automaticRepliesPerOrigin",
      maximum: CONVERSATION_ROUND_LIMITS_RANGE.automaticRepliesMaximum,
    },
  ] as const;
  return (
    <fieldset className="space-y-4" disabled={isDisabled}>
      <legend className="mb-2 text-sm font-medium">
        {t("chatPage.replySettings.roundLimits")}
      </legend>
      {fields.map(({ key, maximum }) => (
        <div key={key}>
          <label className="mb-1.5 block text-sm" htmlFor={`reply-${key}`}>
            {t(`chatPage.replySettings.${key}`)}
          </label>
          <Select
            id={`reply-${key}`}
            ariaLabel={t(`chatPage.replySettings.${key}`)}
            disabled={isDisabled}
            value={String(limits[key])}
            options={Array.from({ length: maximum }, (_, index) => ({
              value: String(index + 1),
              label: String(index + 1),
            }))}
            onValueChange={(count) =>
              onChange({ ...limits, [key]: Number(count) })
            }
          />
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        {t("chatPage.replySettings.followUpHint")}
      </p>
    </fieldset>
  );
}
