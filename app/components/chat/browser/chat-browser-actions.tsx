import { Bot, CircleAlert, User } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { PicaBrowserView } from "@/definition/PicaBrowser";

interface ChatBrowserActionsProps {
  readonly actions: PicaBrowserView["actions"];
  readonly className?: string;
}

/** The actions Pica and the administrator performed in the browser, newest last. */
export function ChatBrowserActions({
  actions,
  className,
}: ChatBrowserActionsProps): React.ReactElement {
  const { t } = useTranslation();
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [actions.length]);
  return (
    <ul
      ref={list}
      aria-label={t("chat.browser.actions")}
      aria-live="polite"
      className={cn("max-h-24 space-y-0.5 overflow-y-auto text-xs", className)}
    >
      {actions.length === 0 ? (
        <li className="text-muted-foreground">{t("chat.browser.noActions")}</li>
      ) : null}
      {actions.map((action) => (
        <li
          key={`${action.at}-${action.summary}`}
          className="flex items-start gap-1.5"
        >
          {action.actor === "pica" ? (
            <Bot
              aria-label={t("chat.browser.byPica")}
              className="mt-0.5 size-3.5 shrink-0 text-primary-text"
            />
          ) : (
            <User
              aria-label={t("chat.browser.byYou")}
              className="mt-0.5 size-3.5 shrink-0 text-info"
            />
          )}
          <span
            className={cn(
              "min-w-0 break-words",
              action.status === "failed" && "text-destructive",
            )}
          >
            {action.status === "failed" ? (
              <CircleAlert
                aria-hidden="true"
                className="mr-1 inline size-3.5"
              />
            ) : null}
            {action.summary}
          </span>
        </li>
      ))}
    </ul>
  );
}
