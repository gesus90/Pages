import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Tooltip } from "@/app/components/ui/tooltip";
import { cn } from "@/app/lib/cn";

import type { VirtualParticipant } from "@/definition/VirtualChat";

/** The access levels below YOLO keep their quiet label. */
const LEVEL_TONE = {
  read_only: "border-border bg-surface text-muted-foreground",
  workspace: "border-info/40 bg-info-subtle text-info",
} as const;

/**
 * The access level of the agent of a direct chat in its head, 32 px high.
 * @remarks
 * YOLO is only a round sign "!" in the destructive color, so nobody
 * overlooks that Pages does not restrict the agent. Its name is
 * "Zugriff: YOLO"; the hint with the explanation of the level shows after a
 * rest of the pointer and at once on keyboard focus. The other levels keep
 * their label.
 * @returns The sign or label, or `null` for a person or an unknown level.
 */
export function AccessBadge({
  participant,
}: {
  readonly participant: VirtualParticipant;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const level = participant.accessLevel;
  if (participant.kind !== "agent" || level === undefined) return null;
  const label = t("chatPage.accessLabel", {
    level: t(`agentEmployees.access.${level}`),
  });
  if (level !== "yolo")
    return (
      <span
        className={cn(
          "inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-xs whitespace-nowrap",
          LEVEL_TONE[level],
        )}
        title={t(`agentEmployees.access.hint.${level}`)}
      >
        {label}
      </span>
    );
  return (
    <Tooltip
      content={
        <>
          <span className="block font-semibold">{label}</span>
          <span className="mt-1 block">
            {t("agentEmployees.access.hint.yolo")}
          </span>
        </>
      }
    >
      {(tooltipId) => (
        <button
          type="button"
          aria-label={label}
          aria-describedby={tooltipId}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive-subtle text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          data-access-level="yolo"
        >
          <CircleAlert aria-hidden="true" className="size-[18px]" />
        </button>
      )}
    </Tooltip>
  );
}

/**
 * The small sign "!" of an agent with YOLO access on its chip in a group.
 * @returns The sign, or `null` for every other access level.
 */
export function AccessMark({
  participant,
}: {
  readonly participant: VirtualParticipant;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (participant.kind !== "agent" || participant.accessLevel !== "yolo")
    return null;
  const label = t("chatPage.accessLabel", {
    level: t("agentEmployees.access.yolo"),
  });
  return (
    <span
      role="img"
      aria-label={label}
      className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-destructive-subtle text-destructive"
      data-access-level="yolo"
      title={`${label}\n${t("agentEmployees.access.hint.yolo")}`}
    >
      <CircleAlert aria-hidden="true" className="size-3.5" />
    </span>
  );
}
