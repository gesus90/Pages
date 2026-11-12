import {
  Columns2,
  Copy,
  Download,
  ExternalLink,
  Maximize2,
  Rows2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { AttachmentFullView } from "./attachment-full-view";
import { downloadUrl } from "./card-types";
import { useChatContent } from "./chat-content-context";
import { ChatMarkdown } from "./chat-markdown";
import { CodeView } from "./code-view";
import { CardAction } from "./content-card";
import { DiffCount, DiffView, useParsedDiff } from "./diff-view";
import { WebView } from "./link-cards";
import { syntaxLanguageLabel } from "./syntax-highlight";
import { copyText, saveTextFile, useCardText } from "./use-card-text";

import type { TFunction } from "i18next";
import type { ContentCardDescriptor, OpenedCard } from "./card-types";
import type { DiffLayout } from "./diff-view";

/** The kind of a card as the head of the panel names it. */
function kindLabel(descriptor: ContentCardDescriptor, t: TFunction): string {
  if (descriptor.kind === "code") {
    const label = syntaxLanguageLabel(descriptor.languageHint);
    return label === "" ? t("chatPage.cards.kind.code") : label;
  }
  return t(`chatPage.cards.kind.${descriptor.kind}`);
}

function nameOf(descriptor: ContentCardDescriptor): string {
  if ("attachment" in descriptor) return descriptor.attachment.name;
  if ("link" in descriptor) return new URL(descriptor.link.url).host;
  return descriptor.name;
}

function formatTime(createdAt: string | undefined, language: string): string {
  if (createdAt === undefined) return "";
  return new Intl.DateTimeFormat(language, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(createdAt));
}

/** Placeholder of a text card whose attachment loads or failed. */
function TextState({
  isFailed,
}: {
  readonly isFailed: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <p className="p-4 text-sm text-muted-foreground" role="status">
      {isFailed
        ? t("chatPage.cards.textFailed")
        : t("chatPage.cards.textLoading")}
    </p>
  );
}

type TextDescriptor = Extract<
  ContentCardDescriptor,
  { readonly kind: "code" | "diff" | "markdown" }
>;

interface TextPanelProps {
  readonly descriptor: TextDescriptor;
  readonly layout: DiffLayout;
}

/** The whole code, diff or Markdown of a card, as large as the panel. */
function TextPanel({ descriptor, layout }: TextPanelProps): React.ReactElement {
  const loaded = useCardText(descriptor, true);
  const diff = useParsedDiff(
    descriptor.kind === "diff" ? (loaded.source ?? "") : "",
  );
  if (loaded.source === null) return <TextState isFailed={loaded.isFailed} />;
  if (descriptor.kind === "diff")
    return <DiffView className="flex-1" diff={diff} layout={layout} />;
  if (descriptor.kind === "markdown")
    return (
      <ChatMarkdown
        className="min-h-0 flex-1 overflow-auto bg-panel-body px-5 py-4"
        source={loaded.source}
      />
    );
  return (
    <CodeView
      className="flex-1"
      languageHint={descriptor.languageHint}
      source={loaded.source}
    />
  );
}

/** The actions of a text card in the head of the panel. */
function TextActions({
  descriptor,
  layout,
  onLayout,
}: TextPanelProps & {
  readonly onLayout: (layout: DiffLayout) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { source } = useCardText(descriptor, true);
  return (
    <>
      {descriptor.kind === "diff" ? (
        <>
          <CardAction
            icon={Rows2}
            isActive={layout === "unified"}
            label={t("chatPage.cards.diff.unified")}
            onClick={() => onLayout("unified")}
          />
          <CardAction
            icon={Columns2}
            isActive={layout === "split"}
            label={t("chatPage.cards.diff.split")}
            onClick={() => onLayout("split")}
          />
        </>
      ) : null}
      {source === null || descriptor.kind === "markdown" ? null : (
        <CardAction
          icon={Copy}
          label={t("chatPage.cards.copy")}
          onClick={() => copyText(source)}
        />
      )}
      {source === null || descriptor.kind !== "code" ? null : (
        <CardAction
          icon={Download}
          label={t("chatPage.cards.saveFile")}
          onClick={() => saveTextFile(descriptor.name, source)}
        />
      )}
    </>
  );
}

/** The actions of the kind of a card, before full screen and close. */
function KindActions({
  descriptor,
  layout,
  onLayout,
}: {
  readonly descriptor: ContentCardDescriptor;
  readonly layout: DiffLayout;
  readonly onLayout: (layout: DiffLayout) => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if ("attachment" in descriptor)
    return (
      <CardAction
        href={downloadUrl(descriptor.attachment)}
        icon={Download}
        label={t("chatPage.cards.download")}
      />
    );
  if ("link" in descriptor)
    return (
      <CardAction
        href={descriptor.link.url}
        icon={ExternalLink}
        isNewTab
        label={t("chatPage.cards.newTab")}
      />
    );
  return (
    <TextActions descriptor={descriptor} layout={layout} onLayout={onLayout} />
  );
}

/** The content of a card as the split view and the full screen show it. */
function PanelBody({
  descriptor,
  layout,
}: {
  readonly descriptor: ContentCardDescriptor;
  readonly layout: DiffLayout;
}): React.ReactElement {
  const { conversationId } = useChatContent();
  if ("attachment" in descriptor)
    return <AttachmentFullView attachment={descriptor.attachment} />;
  if ("link" in descriptor)
    return (
      <WebView
        className="flex min-h-0 flex-1 flex-col"
        conversationId={conversationId}
        link={descriptor.link}
      />
    );
  return <TextPanel descriptor={descriptor} layout={layout} />;
}

/** The subtitle of the panel head: kind, sender and time, and the count of a diff. */
function PanelSubtitle({
  card,
}: {
  readonly card: OpenedCard;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { descriptor, origin } = card;
  const time = formatTime(origin.createdAt, i18n.language);
  const diff = useParsedDiff(
    descriptor.kind === "diff" ? (descriptor.source ?? "") : "",
  );
  return (
    <span className="shrink-0 text-xs text-muted-foreground">
      {[kindLabel(descriptor, t), origin.senderName, time]
        .filter((entry) => entry !== "")
        .join(" · ")}
      {descriptor.kind === "diff" && descriptor.source !== null ? (
        <>
          {" · "}
          <DiffCount diff={diff} />
        </>
      ) : null}
    </span>
  );
}

interface CardPanelProps {
  readonly card: OpenedCard;
  /** Offers "Vollbild"; missing in the full screen itself. */
  readonly onFullscreen?: () => void;
  readonly onClose: () => void;
  readonly className?: string;
  /** The width the person gave the split view. */
  readonly style?: React.CSSProperties;
}

/**
 * One card opened large (PAGE-298), next to the chat or over the page: a
 * head with name, kind, sender and time, the actions of the kind, full
 * screen and close, and below it the content.
 *
 * @remarks
 * A diff switches here between "Untereinander" and "Nebeneinander". The
 * frame and its controls use the tokens of the other panels; only images,
 * videos, PDF pages and embedded web pages keep their own colors.
 */
export function CardPanel({
  card,
  onFullscreen,
  onClose,
  className,
  style,
}: CardPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const [layout, setLayout] = useState<DiffLayout>("split");
  const name = nameOf(card.descriptor);
  return (
    <section
      aria-label={name}
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface text-foreground",
        className,
      )}
      data-card-panel={card.key}
      style={style}
    >
      <header className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-2">
        <p className="flex min-w-56 flex-1 items-baseline gap-2.5">
          <span className="truncate text-sm font-semibold">{name}</span>
          <PanelSubtitle card={card} />
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <KindActions
            descriptor={card.descriptor}
            layout={layout}
            onLayout={setLayout}
          />
          {onFullscreen ? (
            <CardAction
              icon={Maximize2}
              label={t("chatPage.cards.fullscreen")}
              onClick={onFullscreen}
            />
          ) : null}
          <CardAction
            icon={X}
            isIconOnly
            label={t("chatPage.cards.close")}
            onClick={onClose}
          />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col bg-panel-body">
        <PanelBody descriptor={card.descriptor} layout={layout} />
      </div>
    </section>
  );
}

/**
 * The card that covers the page (PAGE-298): the viewer of a PDF or an
 * image, the full screen of a card, and "Daneben" on a narrow screen.
 * Escape and the close button end it.
 */
export function CardOverlay(): React.ReactElement | null {
  const { t } = useTranslation();
  const { overlay, closeOverlay } = useChatContent();

  useEffect(() => {
    if (!overlay) return undefined;
    function handleKey(event: KeyboardEvent): void {
      if (event.key === "Escape") closeOverlay();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [overlay, closeOverlay]);

  if (!overlay) return null;
  return (
    <div
      aria-label={t("chatPage.cards.viewer")}
      aria-modal="true"
      className="fixed inset-0 z-50 flex bg-scrim-drawer p-0 lg:p-10"
      role="dialog"
    >
      <CardPanel
        card={overlay}
        className="flex-1 border border-border shadow-overlay lg:rounded-2xl"
        onClose={closeOverlay}
      />
    </div>
  );
}
