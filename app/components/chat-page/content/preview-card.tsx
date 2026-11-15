import {
  Braces,
  Download,
  FileCode2,
  Image as ImageIcon,
  Table2,
  Workflow,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useChatContent } from "./chat-content-context";
import { CardAction, ContentCard } from "./content-card";
import { downloadPreviewFiles } from "./preview-download";
import { codeKindLabel } from "./preview-kinds";
import { PreviewCode, PreviewView } from "./preview-views";
import { ViewTabs } from "./view-tabs";

import type { TFunction } from "i18next";
import type { LucideIcon } from "lucide-react";
import type { CardOrigin, ContentCardDescriptor } from "./card-types";
import type { PreviewFile, PreviewKind } from "./preview-kinds";

/** The tab of a preview card: the preview or its code. */
export type PreviewTab = "preview" | "code";

/** The icon of each kind of preview, as the card head shows it. */
export const PREVIEW_ICONS: Readonly<Record<PreviewKind, LucideIcon>> = {
  html: FileCode2,
  svg: ImageIcon,
  mermaid: Workflow,
  json: Braces,
  csv: Table2,
  tsv: Table2,
};

/** The body class of each kind inside a card of the history. */
const CARD_BODY_CLASSES: Readonly<Record<PreviewKind, string>> = {
  html: "m-3 h-[26rem]",
  svg: "m-3 h-[22rem]",
  mermaid: "max-h-[32rem]",
  json: "max-h-[32rem]",
  csv: "max-h-[32rem]",
  tsv: "max-h-[32rem]",
};

type PreviewDescriptor = Extract<
  ContentCardDescriptor,
  { readonly kind: "preview" }
>;

function lineCount(files: readonly PreviewFile[]): number {
  return files.reduce(
    (sum, file) =>
      sum + (file.source === "" ? 0 : file.source.split("\n").length),
    0,
  );
}

/**
 * The kind of a preview as its head names it: `HTML`, or "automatisch
 * erkannt: HTML" when the fence named no language (PAGE-383).
 *
 * @param descriptor - The preview.
 * @param t - The translation function.
 */
export function previewKindLabel(
  descriptor: Pick<PreviewDescriptor, "files" | "isDetected">,
  t: TFunction,
): string {
  const label = codeKindLabel(descriptor.files[0]?.languageHint ?? "");
  return descriptor.isDetected
    ? t("chatPage.cards.detected", { kind: label })
    : label;
}

/**
 * Lines and, for several files, the number of files of a preview.
 *
 * @param files - The files of the preview.
 * @param t - The translation function.
 */
export function previewMeta(
  files: readonly PreviewFile[],
  t: TFunction,
): string {
  const lines = t("chatPage.cards.lines", { count: lineCount(files) });
  if (files.length < 2) return lines;
  return `${t("chatPage.preview.fileCount", { count: files.length })} · ${lines}`;
}

/** The tabs "Vorschau | Code" of a preview. */
export function PreviewTabs({
  value,
  onChange,
}: {
  readonly value: PreviewTab;
  readonly onChange: (tab: PreviewTab) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ViewTabs
      label={t("chatPage.preview.view")}
      onChange={onChange}
      options={[
        { value: "preview", label: t("chatPage.preview.preview") },
        { value: "code", label: t("chatPage.preview.code") },
      ]}
      value={value}
    />
  );
}

/** Stands in the card while the preview runs next to the chat or in full screen. */
function OpenedElsewhere({
  isBeside,
}: {
  readonly isBeside: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <p
      className="bg-panel-body px-3 py-4 text-sm text-muted-foreground"
      role="status"
    >
      {isBeside
        ? t("chatPage.cards.besideOpen")
        : t("chatPage.preview.fullscreenOpen")}
    </p>
  );
}

interface PreviewCardProps {
  readonly cardKey: string;
  readonly kind: PreviewKind;
  /** The name the fence gives, or empty. */
  readonly name: string;
  readonly files: readonly PreviewFile[];
  readonly isDetected: boolean;
  readonly origin: CardOrigin;
}

/**
 * A preview card of the chat (PAGE-383): the tabs "Vorschau | Code", the
 * preview open by default, "Herunterladen" in the accent color, "Neu laden"
 * for HTML, "Daneben", "Vollbild" and "Zuklappen".
 *
 * @remarks
 * The preview starts as soon as the card is shown, without a click. A
 * collapsed card renders no preview, and while the preview is opened next
 * to the chat or in full screen, the card says so instead of running it a
 * second time.
 */
export function PreviewCard({
  cardKey,
  kind,
  name,
  files,
  isDetected,
  origin,
}: PreviewCardProps): React.ReactElement {
  const { t } = useTranslation();
  const content = useChatContent();
  const [tab, setTab] = useState<PreviewTab>("preview");
  const [reloadKey, setReloadKey] = useState(0);
  const kindLabel = previewKindLabel({ files, isDetected }, t);
  const title =
    name === ""
      ? t("chatPage.preview.name", {
          kind: codeKindLabel(files[0]?.languageHint ?? ""),
        })
      : name;
  const descriptor: PreviewDescriptor = {
    kind: "preview",
    name: title,
    previewKind: kind,
    files,
    isDetected,
  };
  const card = { key: cardKey, descriptor, origin };
  const isBeside = content.beside?.key === cardKey;
  const isElsewhere = isBeside || content.overlay?.key === cardKey;

  function handleReload(): void {
    setTab("preview");
    setReloadKey(reloadKey + 1);
  }

  return (
    <ContentCard
      beside={card}
      cardKey={cardKey}
      defaultState="expanded"
      icon={PREVIEW_ICONS[kind]}
      kindLabel={kindLabel}
      meta={previewMeta(files, t)}
      name={title}
      onFullscreen={() => content.openOverlay(card)}
      onReload={kind === "html" ? handleReload : undefined}
      primary={
        <CardAction
          icon={Download}
          label={t("chatPage.cards.download")}
          onClick={() => downloadPreviewFiles(files)}
          variant="primary"
        />
      }
      tabs={<PreviewTabs onChange={setTab} value={tab} />}
    >
      {isElsewhere ? <OpenedElsewhere isBeside={isBeside} /> : null}
      {!isElsewhere && tab === "preview" ? (
        <PreviewView
          className={CARD_BODY_CLASSES[kind]}
          files={files}
          kind={kind}
          reloadKey={reloadKey}
          title={title}
        />
      ) : null}
      {!isElsewhere && tab === "code" ? (
        <PreviewCode className="max-h-[32rem]" files={files} />
      ) : null}
    </ContentCard>
  );
}
