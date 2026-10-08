import { useTranslation } from "react-i18next";
import { Link, useFetcher } from "react-router";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { wikiPagePath } from "@/app/lib/wiki-tree";

import type { WikiFeedItem } from "@/definition/Wiki";

/**
 * The area "For me": mentions, replies to the person's comments, comments on
 * their pages and their pages that are no longer current, unread ones marked.
 */
export function WikiFeedView({
  feed,
}: {
  readonly feed: readonly WikiFeedItem[];
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const markRead = useFetcher();
  const unread = feed.filter((item) => item.isUnread).length;

  return (
    <section aria-label={t("wiki.feed.title")} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase">
          {t("wiki.feed.title")}
          {unread > 0 ? ` (${t("wiki.feed.unread", { count: unread })})` : ""}
        </h2>
        {unread > 0 ? (
          <markRead.Form action="/wiki" method="post">
            <input name="intent" type="hidden" value="mark-feed-read" />
            <Button size="sm" type="submit" variant="outline">
              {t("wiki.feed.markRead")}
            </Button>
          </markRead.Form>
        ) : null}
      </div>
      {feed.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("wiki.feed.empty")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {feed.map((item) => (
            <li
              key={`${item.reason}:${item.pageId}:${item.at}:${item.excerpt}`}
              className={cn(
                "px-4 py-2 text-sm",
                item.isUnread && "bg-primary-subtle",
              )}
            >
              <Link
                className="font-medium text-primary hover:underline"
                to={wikiPagePath(item.pageId, item.pageTitle)}
              >
                {item.pageTitle}
              </Link>
              <span className="ml-2 text-muted-foreground">
                {t(`wiki.feed.reason.${item.reason}`, { name: item.actorName })}
                {" · "}
                {formatDateTime(item.at)}
              </span>
              {item.isUnread ? (
                <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                  {t("wiki.feed.new")}
                </span>
              ) : null}
              {item.excerpt ? (
                <p className="mt-0.5 line-clamp-2 text-muted-foreground">
                  {item.excerpt}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
