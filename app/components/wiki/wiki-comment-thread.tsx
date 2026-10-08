import { Check, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import { WikiActionDialog } from "@/app/components/wiki/wiki-action-dialog";
import { WikiCommentComposer } from "@/app/components/wiki/wiki-comment-composer";
import { wikiPagePath } from "@/app/lib/wiki-tree";

import type { WikiActionResult } from "@/app/lib/wiki-actions/wiki-action-support.server";
import type { WikiComment, WikiCommentThread } from "@/definition/Wiki";

interface WikiCommentThreadViewProps {
  readonly pageId: string;
  readonly thread: WikiCommentThread;
}

function CommentBody({
  comment,
  pageId,
}: {
  readonly comment: WikiComment;
  readonly pageId: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const fetcher = useFetcher<WikiActionResult>();
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [text, setText] = useState(comment.body);

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {comment.authorName}
        </span>{" "}
        · {formatDateTime(comment.createdAt)}
        {comment.updatedAt !== comment.createdAt
          ? ` · ${t("wiki.comments.edited")}`
          : ""}
      </p>
      {isEditing ? (
        <fetcher.Form
          action={wikiPagePath(pageId)}
          className="space-y-2"
          method="post"
          onSubmit={() => setIsEditing(false)}
        >
          <input name="intent" type="hidden" value="edit-comment" />
          <input name="commentId" type="hidden" value={comment.id} />
          <Textarea
            aria-label={t("wiki.comments.editLabel")}
            className="min-h-16 text-sm"
            name="body"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsEditing(false)}
            >
              {t("wiki.dialog.cancel")}
            </Button>
            <Button disabled={text.trim() === ""} size="sm" type="submit">
              {t("wiki.dialog.save")}
            </Button>
          </div>
        </fetcher.Form>
      ) : (
        <p className="pages-selectable text-sm break-words whitespace-pre-wrap">
          {comment.body}
        </p>
      )}
      {fetcher.data?.ok === false ? (
        <p className="text-xs text-destructive" role="alert">
          {t(`wiki.errors.${fetcher.data.error}`)}
        </p>
      ) : null}
      <div className="flex gap-1">
        {comment.canEdit && !isEditing ? (
          <Button
            aria-label={t("wiki.comments.edit")}
            size="icon-sm"
            variant="ghost"
            onClick={() => setIsEditing(true)}
          >
            <Pencil aria-hidden="true" className="size-3.5" />
          </Button>
        ) : null}
        {comment.canChange ? (
          <Button
            aria-label={t("wiki.comments.delete")}
            size="icon-sm"
            variant="ghost"
            onClick={() => setIsDeleting(true)}
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
          </Button>
        ) : null}
      </div>
      {isDeleting ? (
        <WikiActionDialog
          action={wikiPagePath(pageId)}
          description={t("wiki.comments.deleteDescription")}
          fields={{ commentId: comment.id, intent: "delete-comment" }}
          isDestructive
          submitLabel={t("wiki.comments.delete")}
          title={t("wiki.comments.deleteTitle")}
          onClose={() => setIsDeleting(false)}
        />
      ) : null}
    </div>
  );
}

/** A first comment with its replies and the buttons to answer or resolve. */
export function WikiCommentThreadView({
  pageId,
  thread,
}: WikiCommentThreadViewProps): React.ReactElement {
  const { t } = useTranslation();
  const resolve = useFetcher<WikiActionResult>();
  const [isReplying, setIsReplying] = useState(false);
  const { comment, replies } = thread;
  const isResolved = comment.resolvedAt !== null;

  return (
    <li className="space-y-2 rounded-xl border border-border p-3">
      {comment.quote ? (
        <blockquote className="border-l-2 border-warning pl-2 text-xs text-muted-foreground italic">
          <span className="pages-selectable">{comment.quote}</span>
          {comment.isStale ? (
            <span className="ml-2 rounded bg-warning-subtle px-1.5 py-0.5 text-warning not-italic">
              {t("wiki.comments.stale")}
            </span>
          ) : null}
        </blockquote>
      ) : null}
      <CommentBody comment={comment} pageId={pageId} />
      {replies.length > 0 ? (
        <ul className="space-y-2 border-l border-border pl-3">
          {replies.map((reply) => (
            <li key={reply.id}>
              <CommentBody comment={reply} pageId={pageId} />
            </li>
          ))}
        </ul>
      ) : null}
      {isReplying ? (
        <WikiCommentComposer
          label={t("wiki.comments.replyLabel")}
          pageId={pageId}
          parentId={comment.id}
          quote={null}
          submitLabel={t("wiki.comments.reply")}
          onDone={() => setIsReplying(false)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsReplying(true)}
          >
            {t("wiki.comments.reply")}
          </Button>
          <resolve.Form action={wikiPagePath(pageId)} method="post">
            <input name="intent" type="hidden" value="resolve-comment" />
            <input name="commentId" type="hidden" value={comment.id} />
            <input
              name="resolved"
              type="hidden"
              value={isResolved ? "0" : "1"}
            />
            <Button size="sm" type="submit" variant="ghost">
              {isResolved ? (
                <RotateCcw aria-hidden="true" className="size-4" />
              ) : (
                <Check aria-hidden="true" className="size-4" />
              )}
              {t(isResolved ? "wiki.comments.reopen" : "wiki.comments.resolve")}
            </Button>
          </resolve.Form>
        </div>
      )}
    </li>
  );
}
