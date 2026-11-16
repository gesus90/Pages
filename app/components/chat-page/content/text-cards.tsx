import { Code, Copy, Download, FileDiff, FileText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useChatContent } from "./chat-content-context";
import { ChatMarkdown } from "./chat-markdown";
import { CodeView } from "./code-view";
import { CardAction, ContentCard } from "./content-card";
import { DiffCount, DiffView, useParsedDiff } from "./diff-view";
import { codeKindLabel } from "./preview-kinds";
import { copyText, saveTextFile, useCardText } from "./use-card-text";
import { ViewTabs } from "./view-tabs";

import type { ChatCardState } from "@/definition/ConversationContent";
import type {
  CardOrigin,
  CardText,
  ContentCardDescriptor,
  OpenedCard,
} from "./card-types";
import type { LoadedCardText } from "./use-card-text";

/** Code up to this many lines is expanded by default; longer code is collapsed. */
const CODE_EXPANDED_LINES = 15;

/** What every text card is given. */
interface TextCardProps {
  readonly cardKey: string;
  /** The file name, or empty for a block without one. */
  readonly name: string;
  readonly text: CardText;
  readonly origin: CardOrigin;
}

function lineCount(source: string): number {
  return source === "" ? 0 : source.split("\n").length;
}

/** The body of a text card while its attachment loads or after it failed. */
function TextPlaceholder({
  loaded,
}: {
  readonly loaded: LoadedCardText;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <p className="px-3 py-3 text-sm text-muted-foreground" role="status">
      {loaded.isFailed
        ? t("chatPage.cards.textFailed")
        : t("chatPage.cards.textLoading")}
    </p>
  );
}

/** The text of a card, loaded only while the card is expanded. */
function useShownText(
  cardKey: string,
  text: CardText,
  defaultState: ChatCardState,
): LoadedCardText {
  const content = useChatContent();
  return useCardText(
    text,
    content.stateOf(cardKey, defaultState) === "expanded",
  );
}

function opened(
  cardKey: string,
  descriptor: ContentCardDescriptor,
  origin: CardOrigin,
): OpenedCard {
  return { key: cardKey, descriptor, origin };
}

/**
 * A code card: syntax colors by the language of the fence, the
 * file ending or, for a fence without language, the recognized language
 * ("automatisch erkannt: SQL"), line numbers, at most 20 lines
 * until "Alle Zeilen zeigen". Up to 15 lines it is expanded by default,
 * longer code is collapsed. "Kopieren" is its main action.
 */
export function CodeCard({
  cardKey,
  name,
  languageHint,
  isDetected = false,
  text,
  origin,
}: TextCardProps & {
  readonly languageHint: string;
  readonly isDetected?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const content = useChatContent();
  const lines = text.source === null ? null : lineCount(text.source);
  const defaultState =
    lines !== null && lines <= CODE_EXPANDED_LINES ? "expanded" : "collapsed";
  const loaded = useShownText(cardKey, text, defaultState);
  const label = codeKindLabel(languageHint);
  const kindLabel = label === "" ? t("chatPage.cards.kind.code") : label;
  const fileName = name === "" ? t("chatPage.cards.codeFile") : name;
  const { source } = loaded;
  const card = opened(
    cardKey,
    { kind: "code", name: fileName, languageHint, isDetected, ...text },
    origin,
  );
  let headKind = name === "" ? t("chatPage.cards.kind.code") : kindLabel;
  if (isDetected) headKind = t("chatPage.cards.detected", { kind: kindLabel });
  return (
    <ContentCard
      actions={
        source === null ? null : (
          <CardAction
            icon={Download}
            label={t("chatPage.cards.saveFile")}
            onClick={() => saveTextFile(fileName, source)}
          />
        )
      }
      beside={card}
      cardKey={cardKey}
      defaultState={defaultState}
      icon={Code}
      kindLabel={headKind}
      meta={lines === null ? null : t("chatPage.cards.lines", { count: lines })}
      name={name === "" ? kindLabel : name}
      onFullscreen={() => content.openOverlay(card)}
      primary={
        source === null ? null : (
          <CardAction
            icon={Copy}
            label={t("chatPage.cards.copy")}
            onClick={() => copyText(source)}
            variant="primary"
          />
        )
      }
    >
      {source === null ? (
        <TextPlaceholder loaded={loaded} />
      ) : (
        <CodeView isPreview languageHint={languageHint} source={source} />
      )}
    </ContentCard>
  );
}

/**
 * A diff card: green added and red removed lines; the
 * head names the file and below it "Diff · +N −M"; collapsed by default.
 * @remarks
 * "Kopieren" is the main action in the accent color, "Ganze Datei" stays a
 * framed action of the kind, then "Daneben", "Vollbild" and "Zuklappen".
 * Split view and full screen switch between "Untereinander" and
 * "Nebeneinander".
 */
export function DiffCard({
  cardKey,
  name,
  text,
  origin,
}: TextCardProps): React.ReactElement {
  const { t } = useTranslation();
  const content = useChatContent();
  const loaded = useShownText(cardKey, text, "collapsed");
  const diff = useParsedDiff(loaded.source ?? "");
  const { source } = loaded;
  const title =
    diff.fileName ?? (name === "" ? t("chatPage.cards.kind.diff") : name);
  const card = opened(cardKey, { kind: "diff", name: title, ...text }, origin);
  return (
    <ContentCard
      actions={
        text.sourceUrl === undefined ? null : (
          <CardAction
            href={`${text.sourceUrl}?download=1`}
            icon={Download}
            label={t("chatPage.cards.wholeFile")}
          />
        )
      }
      beside={card}
      cardKey={cardKey}
      defaultState="collapsed"
      icon={FileDiff}
      kindLabel={t("chatPage.cards.kind.diff")}
      meta={source === null ? null : <DiffCount diff={diff} />}
      name={title}
      onFullscreen={() => content.openOverlay(card)}
      primary={
        source === null ? null : (
          <CardAction
            icon={Copy}
            label={t("chatPage.cards.copy")}
            onClick={() => copyText(source)}
            variant="primary"
          />
        )
      }
    >
      {source === null ? (
        <TextPlaceholder loaded={loaded} />
      ) : (
        <DiffView className="max-h-[32rem]" diff={diff} />
      )}
    </ContentCard>
  );
}

/** The tab of a Markdown card: rendered or as source. */
type MarkdownTab = "rendered" | "source";

/**
 * A Markdown card: the text rendered as the chat renders
 * Markdown, its code blocks in the syntax colors of the code cards, with
 * the tabs "Ansicht | Quelltext". A fence without language
 * whose content is Markdown says "automatisch erkannt: Markdown".
 */
export function MarkdownCard({
  cardKey,
  name,
  text,
  origin,
  isDetected = false,
}: TextCardProps & { readonly isDetected?: boolean }): React.ReactElement {
  const { t } = useTranslation();
  const [tab, setTab] = useState<MarkdownTab>("rendered");
  const loaded = useShownText(cardKey, text, "expanded");
  const title = name === "" ? t("chatPage.cards.kind.markdown") : name;
  const kind = t("chatPage.cards.kind.markdown");
  const { source } = loaded;
  return (
    <ContentCard
      beside={opened(
        cardKey,
        { kind: "markdown", name: title, ...text },
        origin,
      )}
      cardKey={cardKey}
      defaultState="expanded"
      icon={FileText}
      kindLabel={isDetected ? t("chatPage.cards.detected", { kind }) : kind}
      meta={
        source === null
          ? t("chatPage.cards.rendered")
          : t("chatPage.cards.lines", { count: lineCount(source) })
      }
      name={title}
      primary={
        source === null ? null : (
          <CardAction
            icon={Copy}
            label={t("chatPage.cards.copy")}
            onClick={() => copyText(source)}
            variant="primary"
          />
        )
      }
      tabs={
        <ViewTabs
          label={t("chatPage.preview.view")}
          onChange={setTab}
          options={[
            { value: "rendered", label: t("chatPage.preview.rendered") },
            { value: "source", label: t("chatPage.preview.source") },
          ]}
          value={tab}
        />
      }
    >
      {source === null ? <TextPlaceholder loaded={loaded} /> : null}
      {source !== null && tab === "rendered" ? (
        <ChatMarkdown
          className="max-h-[32rem] overflow-auto bg-panel-body px-4 py-3"
          source={source}
        />
      ) : null}
      {source !== null && tab === "source" ? (
        <CodeView
          className="max-h-[32rem]"
          languageHint="markdown"
          source={source}
        />
      ) : null}
    </ContentCard>
  );
}
