import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import { wikiPagePath } from "@/app/lib/wiki-tree";
import { countCharacters, WIKI_LIMITS } from "@/definition/Wiki";

import type { WikiActionResult } from "@/app/lib/wiki-actions/wiki-action-support.server";
import type { QuoteReference } from "@/app/lib/wiki-highlight";

interface WikiCommentComposerProps {
  readonly pageId: string;
  /** The comment this one answers; `null` for a first comment. */
  readonly parentId: string | null;
  /** The passage a first comment refers to. */
  readonly quote: QuoteReference | null;
  readonly label: string;
  readonly submitLabel: string;
  /** Called once the comment is saved, or when the person cancels. */
  readonly onDone: () => void;
}

/** The box for a new comment or reply, with the quoted passage if any. */
export function WikiCommentComposer({
  pageId,
  parentId,
  quote,
  label,
  submitLabel,
  onDone,
}: WikiCommentComposerProps): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<WikiActionResult>();
  const [body, setBody] = useState("");
  const result = fetcher.data;
  const hasSaved = result?.ok === true;
  const length = countCharacters(body);

  useEffect(() => {
    if (hasSaved) {
      setBody("");
      onDone();
    }
  }, [hasSaved, onDone]);

  return (
    <fetcher.Form
      action={wikiPagePath(pageId)}
      className="space-y-2"
      method="post"
    >
      <input name="intent" type="hidden" value="add-comment" />
      <input name="parentId" type="hidden" value={parentId ?? ""} />
      <input name="quote" type="hidden" value={quote?.quote ?? ""} />
      <input name="quotePrefix" type="hidden" value={quote?.prefix ?? ""} />
      <input name="quoteSuffix" type="hidden" value={quote?.suffix ?? ""} />
      {quote ? (
        <p className="border-l-2 border-warning pl-2 text-xs text-muted-foreground italic">
          {quote.quote}
        </p>
      ) : null}
      <Textarea
        aria-label={label}
        className="min-h-20 text-sm"
        name="body"
        placeholder={label}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      {length > WIKI_LIMITS.commentLength * 0.8 ? (
        <p className="text-xs text-muted-foreground">
          {length} / {WIKI_LIMITS.commentLength}
        </p>
      ) : null}
      {result?.ok === false ? (
        <p className="text-sm text-destructive" role="alert">
          {t(`wiki.errors.${result.error}`)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          <X aria-hidden="true" className="size-4" />
          {t("wiki.dialog.cancel")}
        </Button>
        <Button
          disabled={body.trim() === ""}
          isPending={fetcher.state !== "idle"}
          size="sm"
          type="submit"
        >
          {submitLabel}
        </Button>
      </div>
    </fetcher.Form>
  );
}
