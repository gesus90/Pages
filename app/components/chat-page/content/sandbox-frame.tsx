import { ShieldCheck } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { useChatContent } from "./chat-content-context";
import {
  buildPreviewDocument,
  canSendFromPreview,
  isPreviewReady,
  PREVIEW_FRAME_URL,
  PREVIEW_RENDER_MESSAGE,
  PREVIEW_SANDBOX,
  readPreviewSend,
} from "./preview-document";

import type { CardTone } from "./content-card";
import type { PreviewFile } from "./preview-kinds";

/** The widths a preview can be shown at: "Desktop | Tablet | Mobil". */
export type PreviewDevice = "desktop" | "tablet" | "mobile";

const DEVICE_CLASSES: Readonly<Record<PreviewDevice, string>> = {
  desktop: "w-full",
  tablet: "w-[768px] max-w-full",
  mobile: "w-[390px] max-w-full",
};

interface SandboxFrameProps {
  readonly files: readonly PreviewFile[];
  /** The accessible name of the frame. */
  readonly title: string;
  /** Changes with "Neu laden"; a new frame starts the preview again. */
  readonly reloadKey: number;
  readonly device?: PreviewDevice;
  readonly tone?: CardTone;
  readonly className?: string;
}

// Connects a sandbox frame with the chat: hands the frame its document once
// ready, and passes on what the preview writes with `pages.chat.send(text)`.
function usePreviewBridge(
  frame: React.RefObject<HTMLIFrameElement | null>,
  html: string,
  onSend: (text: string) => void,
): void {
  const lastSentAt = useRef(0);

  useEffect(() => {
    function handleMessage(event: MessageEvent): void {
      const element = frame.current;
      if (!element?.contentWindow || event.source !== element.contentWindow)
        return;
      if (isPreviewReady(event.data)) {
        element.contentWindow.postMessage(
          { type: PREVIEW_RENDER_MESSAGE, html },
          "*",
        );
        return;
      }
      const text = readPreviewSend(event.data);
      if (text === null) return;
      const now = Date.now();
      if (
        !canSendFromPreview({
          frame: element,
          lastSentAt: lastSentAt.current,
          now,
        })
      )
        return;
      lastSentAt.current = now;
      onSend(text);
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [frame, html, onSend]);
}

function PreviewFrame({
  files,
  title,
  className,
}: Pick<
  SandboxFrameProps,
  "files" | "title" | "className"
>): React.ReactElement {
  const frame = useRef<HTMLIFrameElement>(null);
  const { sendFromPreview } = useChatContent();
  const html = buildPreviewDocument(files);
  usePreviewBridge(frame, html, sendFromPreview);
  return (
    <iframe
      ref={frame}
      allow=""
      className={cn("block h-full border-0 bg-surface", className)}
      data-preview-frame=""
      referrerPolicy="no-referrer"
      sandbox={PREVIEW_SANDBOX}
      src={PREVIEW_FRAME_URL}
      title={title}
    />
  );
}

/**
 * An HTML or SVG preview in a plain browser frame with the hint "Sandbox ·
 * kein Zugriff auf Pages".
 * @remarks
 * The preview starts as soon as the frame is shown and stops with it, so a
 * collapsed card runs nothing. It runs in a sandboxed frame with an opaque
 * origin of its own: it reaches neither cookies, storage, session nor
 * interfaces of Pages, cannot navigate the page and opens no window, but it
 * may load from the network. Each member of a chat runs it separately in
 * their own browser.
 */
export function SandboxFrame({
  files,
  title,
  reloadKey,
  device = "desktop",
  tone = "light",
  className,
}: SandboxFrameProps): React.ReactElement {
  const { t } = useTranslation();
  const isDark = tone === "dark";
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border",
        isDark
          ? "border-viewer-edge bg-viewer-control"
          : "border-border bg-muted",
        className,
      )}
      data-sandbox-device={device}
    >
      <div
        className={cn(
          "flex h-7 shrink-0 items-center gap-2 border-b px-2.5 text-[11px]",
          isDark
            ? "border-viewer-edge text-viewer-muted"
            : "border-border text-muted-foreground",
        )}
      >
        <span aria-hidden="true" className="flex gap-1">
          <span className="size-2 rounded-full bg-control-border" />
          <span className="size-2 rounded-full bg-control-border" />
          <span className="size-2 rounded-full bg-control-border" />
        </span>
        <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{t("chatPage.preview.sandbox")}</span>
      </div>
      <div className="flex min-h-0 flex-1 justify-center overflow-auto">
        <PreviewFrame
          key={reloadKey}
          className={DEVICE_CLASSES[device]}
          files={files}
          title={title}
        />
      </div>
    </div>
  );
}
