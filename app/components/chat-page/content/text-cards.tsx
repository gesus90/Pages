import { Code, Copy, Download, FileDiff, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useChatContent } from "./chat-content-context";
import { ChatMarkdown } from "./chat-markdown";
import { CodeView } from "./code-view";
import { CardAction, ContentCard } from "./content-card";
import { DiffCount, DiffView, useParsedDiff } from "./diff-view";
import { syntaxLanguageLabel } from "./syntax-highlight";
import { copyText, saveTextFile, useCardText } from "./use-card-text";

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
 * A code card (PAGE-298): syntax colors by the language of the fence or the
 * file ending, line numbers, at most 20 lines until "Alle Zeilen zeigen".
 * Up to 15 lines it is expanded by default, longer code is collapsed.
 */
export function CodeCard({
  cardKey,
  name,
  languageHint,
  text,
  origin,
}: TextCardProps & { readonly languageHint: string }): React.ReactElement {
  const { t } = useTranslation();
  const lines = text.source === null ? null : lineCount(text.source);
  const defaultState =
    lines !== null && lines <= CODE_EXPANDED_LINES ? "expanded" : "collapsed";
  const loaded = useShownText(cardKey, text, defaultState);
  const label = syntaxLanguageLabel(languageHint);
  const kindLabel = label === "" ? t("chatPage.cards.kind.code") : label;
  const fileName = name === "" ? t("chatPage.cards.codeFile") : name;
  const { source } = loaded;
  return (
    <ContentCard
      actions={
        source === null ? null : (
          <>
            <CardAction
              icon={Copy}
              label={t("chatPage.cards.copy")}
              onClick={() => copyText(source)}
            />
            <CardAction
              icon={Download}
              label={t("chatPage.cards.saveFile")}
              onClick={() => saveTextFile(fileName, source)}
            />
          </>
        )
      }
      beside={opened(
        cardKey,
        { kind: "code", name: fileName, languageHint, ...text },
        origin,
      )}
      cardKey={cardKey}
      defaultState={defaultState}
      icon={Code}
      kindLabel={name === "" ? t("chatPage.cards.kind.code") : kindLabel}
      meta={lines === null ? null : t("chatPage.cards.lines", { count: lines })}
      name={name === "" ? kindLabel : name}
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
 * A diff card (PAGE-298): green added and red removed lines with the
 * counter `+N −M` in the head; collapsed by default.
 */
export function DiffCard({
  cardKey,
  name,
  text,
  origin,
}: TextCardProps): React.ReactElement {
  const { t } = useTranslation();
  const loaded = useShownText(cardKey, text, "collapsed");
  const diff = useParsedDiff(loaded.source ?? "");
  const { source } = loaded;
  const title =
    diff.fileName ?? (name === "" ? t("chatPage.cards.kind.diff") : name);
  return (
    <ContentCard
      actions={
        <>
          {source === null ? null : (
            <CardAction
              icon={Copy}
              label={t("chatPage.cards.copy")}
              onClick={() => copyText(source)}
            />
          )}
          {text.sourceUrl === undefined ? null : (
            <CardAction
              href={`${text.sourceUrl}?download=1`}
              icon={Download}
              label={t("chatPage.cards.wholeFile")}
            />
          )}
        </>
      }
      beside={opened(cardKey, { kind: "diff", name: title, ...text }, origin)}
      cardKey={cardKey}
      defaultState="collapsed"
      icon={FileDiff}
      kindLabel={t("chatPage.cards.kind.diff")}
      meta={source === null ? null : <DiffCount diff={diff} />}
      name={title}
    >
      {source === null ? (
        <TextPlaceholder loaded={loaded} />
      ) : (
        <DiffView className="max-h-[32rem]" diff={diff} />
      )}
    </ContentCard>
  );
}

/**
 * A Markdown card (PAGE-298): the text rendered as the chat renders
 * Markdown, its code blocks in the syntax colors of the code cards.
 */
export function MarkdownCard({
  cardKey,
  name,
  text,
  origin,
}: TextCardProps): React.ReactElement {
  const { t } = useTranslation();
  const loaded = useShownText(cardKey, text, "expanded");
  const title = name === "" ? t("chatPage.cards.kind.markdown") : name;
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
      kindLabel={t("chatPage.cards.kind.markdown")}
      meta={t("chatPage.cards.rendered")}
      name={title}
    >
      {loaded.source === null ? (
        <TextPlaceholder loaded={loaded} />
      ) : (
        <ChatMarkdown
          className="max-h-[32rem] overflow-auto bg-panel-body px-4 py-3"
          source={loaded.source}
        />
      )}
    </ContentCard>
  );
}
