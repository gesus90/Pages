import {
  Copy,
  Download,
  Maximize2,
  MessageSquareText,
  Monitor,
  RotateCw,
  Smartphone,
  Tablet,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { CardAction, CardActionDivider, CardHead } from "./content-card";
import {
  PREVIEW_ICONS,
  PreviewTabs,
  previewKindLabel,
} from "./preview-card";
import { downloadPreviewFiles } from "./preview-download";
import { PreviewCode, PreviewView } from "./preview-views";
import { copyText } from "./use-card-text";
import { ViewTabs } from "./view-tabs";

import type { CardOrigin, ContentCardDescriptor } from "./card-types";
import type { CardTone } from "./content-card";
import type { PreviewTab } from "./preview-card";
import type { PreviewDevice } from "./sandbox-frame";

/** A preview as the split view and the full screen open it. */
export type PreviewDescriptor = Extract<
  ContentCardDescriptor,
  { readonly kind: "preview" }
>;

/** The view of the full screen: "Vorschau | Code | Beides". */
export type FullscreenMode = PreviewTab | "both";

function isSandboxed(descriptor: PreviewDescriptor): boolean {
  return descriptor.previewKind === "html" || descriptor.previewKind === "svg";
}

function formatTime(createdAt: string | undefined, language: string): string {
  if (createdAt === undefined) return "";
  return new Intl.DateTimeFormat(language, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(createdAt));
}

/** Kind, sender and time, as the heads of the split view and the full screen show them. */
function PreviewSubtitle({
  descriptor,
  origin,
}: {
  readonly descriptor: PreviewDescriptor;
  readonly origin: CardOrigin;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  return (
    <>
      {[
        previewKindLabel(descriptor, t),
        origin.senderName,
        formatTime(origin.createdAt, i18n.language),
      ]
        .filter((part) => part !== "")
        .join(" · ")}
    </>
  );
}

/** The switch "Desktop | Tablet | Mobil" of the preview width. */
function DeviceTabs({
  value,
  onChange,
  tone = "light",
}: {
  readonly value: PreviewDevice;
  readonly onChange: (device: PreviewDevice) => void;
  readonly tone?: CardTone;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ViewTabs
      label={t("chatPage.preview.device.label")}
      onChange={onChange}
      options={[
        { value: "desktop", label: t("chatPage.preview.device.desktop"), icon: Monitor },
        { value: "tablet", label: t("chatPage.preview.device.tablet"), icon: Tablet },
        { value: "mobile", label: t("chatPage.preview.device.mobile"), icon: Smartphone },
      ]}
      tone={tone}
      value={value}
    />
  );
}

/** "Herunterladen" in the accent color: one file, or several as ZIP. */
function DownloadAction({
  descriptor,
  tone = "light",
}: {
  readonly descriptor: PreviewDescriptor;
  readonly tone?: CardTone;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <CardAction
      icon={Download}
      label={t("chatPage.cards.download")}
      onClick={() => downloadPreviewFiles(descriptor.files)}
      tone={tone}
      variant="primary"
    />
  );
}

interface PreviewPanelProps {
  readonly cardKey: string;
  readonly descriptor: PreviewDescriptor;
  readonly origin: CardOrigin;
  /** Offers "Vollbild". */
  readonly onFullscreen?: () => void;
  readonly onClose: () => void;
  readonly className?: string;
  /** The width the person gave the split view. */
  readonly style?: React.CSSProperties;
}

/**
 * A preview next to the chat (PAGE-383): the head of the cards with title,
 * sender and time, "Vorschau | Code", "Desktop | Tablet | Mobil" for HTML
 * and SVG, "Neu laden" for HTML, "Vollbild" and "Schließen", and below it
 * the preview in its browser frame or the code with its file tabs.
 */
export function PreviewPanel({
  cardKey,
  descriptor,
  origin,
  onFullscreen,
  onClose,
  className,
  style,
}: PreviewPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const [tab, setTab] = useState<PreviewTab>("preview");
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <section
      aria-label={descriptor.name}
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface text-foreground",
        className,
      )}
      data-card-panel={cardKey}
      style={style}
    >
      <CardHead
        actions={
          <>
            <DownloadAction descriptor={descriptor} />
            <CardActionDivider />
            {isSandboxed(descriptor) ? (
              <DeviceTabs onChange={setDevice} value={device} />
            ) : null}
            {descriptor.previewKind === "html" ? (
              <CardAction
                icon={RotateCw}
                isIconOnly
                label={t("chatPage.cards.reload")}
                onClick={() => setReloadKey(reloadKey + 1)}
                variant="quiet"
              />
            ) : null}
            {onFullscreen ? (
              <CardAction
                icon={Maximize2}
                isIconOnly
                label={t("chatPage.cards.fullscreen")}
                onClick={onFullscreen}
                variant="quiet"
              />
            ) : null}
            <CardAction
              icon={X}
              isIconOnly
              label={t("chatPage.cards.close")}
              onClick={onClose}
              variant="quiet"
            />
          </>
        }
        className="border-b border-border px-4"
        icon={PREVIEW_ICONS[descriptor.previewKind]}
        name={descriptor.name}
        subtitle={<PreviewSubtitle descriptor={descriptor} origin={origin} />}
        tabs={<PreviewTabs onChange={setTab} value={tab} />}
      />
      <div className="flex min-h-0 flex-1 flex-col bg-panel-body p-3">
        {tab === "preview" ? (
          <PreviewView
            className="min-h-0 flex-1"
            device={device}
            files={descriptor.files}
            kind={descriptor.previewKind}
            reloadKey={reloadKey}
            title={descriptor.name}
          />
        ) : (
          <PreviewCode
            className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border"
            files={descriptor.files}
          />
        )}
      </div>
    </section>
  );
}

/** Whether a key press belongs to a field, where letters are typed, not shortcuts. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** The keys R (reload) and C (code on and off) of the full screen; Escape closes it in the overlay. */
function useFullscreenKeys(onReload: () => void, onToggleCode: () => void): void {
  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target))
        return;
      const key = event.key.toLowerCase();
      if (key === "r") onReload();
      else if (key === "c") onToggleCode();
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onReload, onToggleCode]);
}

/** Scrolls the card of a preview into view in the history. */
function showCard(cardKey: string): void {
  const card = [...document.querySelectorAll<HTMLElement>("[data-content-card]")].find(
    (element) => element.dataset.contentCard === cardKey,
  );
  card?.scrollIntoView({ block: "center" });
}

interface PreviewFullscreenProps {
  readonly cardKey: string;
  readonly descriptor: PreviewDescriptor;
  readonly origin: CardOrigin;
  readonly onClose: () => void;
}

/** The head of the full screen in its dark variant. */
function FullscreenHead({
  props,
  state,
}: {
  readonly props: PreviewFullscreenProps;
  readonly state: ReturnType<typeof useFullscreenState>;
}): React.ReactElement {
  const { t } = useTranslation();
  const { descriptor, origin, onClose, cardKey } = props;
  const file = descriptor.files.find((entry) => entry.name === state.file) ?? descriptor.files[0];
  return (
    <CardHead
      actions={
        <>
          <DownloadAction descriptor={descriptor} tone="dark" />
          <CardActionDivider tone="dark" />
          {isSandboxed(descriptor) && state.mode !== "code" ? (
            <DeviceTabs onChange={state.setDevice} tone="dark" value={state.device} />
          ) : null}
          {descriptor.previewKind === "html" ? (
            <CardAction icon={RotateCw} isIconOnly label={t("chatPage.cards.reload")} onClick={state.reload} tone="dark" variant="quiet" />
          ) : null}
          <CardAction icon={Copy} isIconOnly label={t("chatPage.cards.copy")} onClick={() => copyText(file?.source ?? "")} tone="dark" variant="quiet" />
          <CardAction
            icon={MessageSquareText}
            isIconOnly
            label={t("chatPage.cards.toMessage")}
            onClick={() => {
              onClose();
              showCard(cardKey);
            }}
            tone="dark"
            variant="quiet"
          />
          <CardAction icon={X} isIconOnly label={t("chatPage.cards.close")} onClick={onClose} tone="dark" variant="quiet" />
        </>
      }
      className="border-b border-viewer-edge px-4"
      icon={PREVIEW_ICONS[descriptor.previewKind]}
      name={descriptor.name}
      subtitle={<PreviewSubtitle descriptor={descriptor} origin={origin} />}
      tabs={
        <ViewTabs
          label={t("chatPage.preview.view")}
          onChange={state.setMode}
          options={[
            { value: "preview", label: t("chatPage.preview.preview") },
            { value: "code", label: t("chatPage.preview.code") },
            { value: "both", label: t("chatPage.preview.both") },
          ]}
          tone="dark"
          value={state.mode}
        />
      }
      tone="dark"
    />
  );
}

/** View, device, reload and shown file of the full screen. */
function useFullscreenState(firstFile: string): {
  readonly mode: FullscreenMode;
  readonly setMode: (mode: FullscreenMode) => void;
  readonly device: PreviewDevice;
  readonly setDevice: (device: PreviewDevice) => void;
  readonly reloadKey: number;
  readonly reload: () => void;
  readonly file: string;
  readonly setFile: (name: string) => void;
} {
  const [mode, setMode] = useState<FullscreenMode>("preview");
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [reloadKey, setReloadKey] = useState(0);
  const [file, setFile] = useState(firstFile);
  const reload = (): void => setReloadKey((key) => key + 1);
  const toggleCode = (): void =>
    setMode((current) => (current === "preview" ? "both" : "preview"));
  useFullscreenKeys(reload, toggleCode);
  return { mode, setMode, device, setDevice, reloadKey, reload, file, setFile };
}

/**
 * A preview over the whole page (PAGE-383): a dark surface with the head of
 * the cards, "Vorschau | Code | Beides" (preview left, code with file tabs
 * right), the device widths, "Neu laden", "Kopieren", "Herunterladen" as
 * file or ZIP, "Zur Nachricht" and "Schließen". Escape closes it, R loads it
 * again and C shows or hides the code.
 */
export function PreviewFullscreen(props: PreviewFullscreenProps): React.ReactElement {
  const { t } = useTranslation();
  const { descriptor } = props;
  const state = useFullscreenState(descriptor.files[0]?.name ?? "");
  const isBoth = state.mode === "both";
  return (
    <div
      aria-label={t("chatPage.cards.viewer")}
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-viewer-scrim text-viewer-foreground"
      data-preview-fullscreen={state.mode}
      role="dialog"
    >
      <FullscreenHead props={props} state={state} />
      <div className={cn("grid min-h-0 flex-1 gap-3 p-3", isBoth && "lg:grid-cols-2")}>
        {state.mode === "code" ? null : (
          <PreviewView
            className="h-full min-h-0"
            device={state.device}
            files={descriptor.files}
            kind={descriptor.previewKind}
            reloadKey={state.reloadKey}
            title={descriptor.name}
            tone="dark"
          />
        )}
        {state.mode === "preview" ? null : (
          <PreviewCode
            className="h-full min-h-0 overflow-hidden rounded-lg border border-viewer-edge bg-panel-body"
            files={descriptor.files}
            onSelect={state.setFile}
            selected={state.file}
            tone="dark"
          />
        )}
      </div>
    </div>
  );
}
