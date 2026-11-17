import { Check, Hand, Pause, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { LucideIcon } from "lucide-react";
import type { PicaBrowserState } from "@/definition/PicaBrowser";

/** Color and symbol of each state, so the state never rests on color alone. */
const BADGES: Readonly<
  Record<
    PicaBrowserState,
    { readonly className: string; readonly Icon: LucideIcon }
  >
> = {
  running: { className: "bg-success-subtle text-success", Icon: Check },
  paused: { className: "bg-warning-subtle text-warning", Icon: Pause },
  takeover: { className: "bg-info-subtle text-info", Icon: Hand },
  stopped: { className: "bg-muted text-muted-foreground", Icon: Square },
};

/** The badge of a browser's state: a symbol and the word, 22 px high at every state. */
export function ChatBrowserStateBadge({
  state,
}: {
  readonly state: PicaBrowserState;
}): React.ReactElement {
  const { t } = useTranslation();
  const { className, Icon } = BADGES[state];
  return (
    <span
      className={cn(
        "inline-flex h-5.5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold whitespace-nowrap",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {t(`chat.browser.state.${state}`)}
    </span>
  );
}
