import { Hand, OctagonX, Pause, Play, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { ChatBrowsers } from "./use-chat-browser";
import type { PicaBrowserView } from "@/definition/PicaBrowser";

interface ChatBrowserControlsProps {
  readonly browser: PicaBrowserView;
  readonly controller: ChatBrowsers;
}

/** Pause, resume, take over, hand back and stop: the controls an administrator keeps over Pica's browser. */
export function ChatBrowserControls({
  browser,
  controller,
}: ChatBrowserControlsProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { state } = browser;
  if (state === "stopped") return null;
  const send = (
    command: "pause" | "resume" | "takeover" | "handback" | "stop",
  ): void => void controller.command(browser.browserId, { command });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {state === "running" ? (
        <Button size="xs" variant="outline" onClick={() => send("pause")}>
          <Pause aria-hidden="true" className="size-3.5" />
          {t("chat.browser.pause")}
        </Button>
      ) : null}
      {state === "paused" ? (
        <Button size="xs" variant="outline" onClick={() => send("resume")}>
          <Play aria-hidden="true" className="size-3.5" />
          {t("chat.browser.resume")}
        </Button>
      ) : null}
      {state === "takeover" ? (
        <Button size="xs" onClick={() => send("handback")}>
          <Undo2 aria-hidden="true" className="size-3.5" />
          {t("chat.browser.handback")}
        </Button>
      ) : (
        <Button size="xs" variant="outline" onClick={() => send("takeover")}>
          <Hand aria-hidden="true" className="size-3.5" />
          {t("chat.browser.takeover")}
        </Button>
      )}
      <Button size="xs" variant="destructive-soft" onClick={() => send("stop")}>
        <OctagonX aria-hidden="true" className="size-3.5" />
        {t("chat.browser.stop")}
      </Button>
    </div>
  );
}
