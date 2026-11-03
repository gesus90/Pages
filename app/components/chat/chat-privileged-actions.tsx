import { Check, CircleAlert, LoaderCircle, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ChatJobToolEvent } from "@/definition/ChatJob";

/** The most recent administrator calls shown at once; the journal keeps every call. */
const MAXIMUM_SHOWN = 8;

interface ChatPrivilegedActionsProps {
  readonly tools: readonly ChatJobToolEvent[];
}

function ActionIcon({
  status,
}: {
  readonly status: ChatJobToolEvent["status"];
}): React.ReactElement {
  if (status === "running")
    return (
      <LoaderCircle
        aria-hidden="true"
        className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
      />
    );
  return status === "completed" ? (
    <Check aria-hidden="true" className="size-3.5 shrink-0 text-success" />
  ) : (
    <CircleAlert
      aria-hidden="true"
      className="size-3.5 shrink-0 text-destructive"
    />
  );
}

/**
 * The calls Pica makes with administrator rights, as they happen: the tool,
 * its state and, when it failed, the reason.
 *
 * @remarks
 * Ordinary tool calls stay out of the quiet activity row. Parameters and
 * results never reach the browser; the audit trail of the administration
 * keeps what changed.
 */
export function ChatPrivilegedActions({
  tools,
}: ChatPrivilegedActionsProps): React.ReactElement | null {
  const { t } = useTranslation();
  const privileged = tools.filter((tool) => tool.isPrivileged === true);
  if (privileged.length === 0) return null;
  const shown = privileged.slice(-MAXIMUM_SHOWN);
  const earlier = privileged.length - shown.length;
  return (
    <section
      aria-label={t("chat.privileged.label")}
      className="ml-9 space-y-1 text-xs"
    >
      <p className="flex items-center gap-1 font-medium text-muted-foreground">
        <ShieldCheck aria-hidden="true" className="size-3.5" />
        {t("chat.privileged.heading")}
      </p>
      <ul aria-live="polite" className="space-y-0.5">
        {earlier > 0 ? (
          <li className="text-muted-foreground">
            {t("chat.privileged.earlier", { count: earlier })}
          </li>
        ) : null}
        {shown.map((tool) => (
          <li
            key={tool.callId}
            className="flex flex-wrap items-center gap-x-1.5"
          >
            <ActionIcon status={tool.status} />
            <code className="break-all">{tool.tool}</code>
            <span className="text-muted-foreground">
              {tool.status === "failed"
                ? t([
                    `chat.privileged.errors.${tool.error ?? "FAILED"}`,
                    "chat.privileged.errors.FAILED",
                  ])
                : t(`chat.privileged.status.${tool.status}`)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
