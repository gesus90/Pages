import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { WikiActionDialog } from "@/app/components/wiki/wiki-action-dialog";

import type { WikiPrivatePlaceholder } from "@/definition/Wiki";

interface WikiPrivatePlaceholderViewProps {
  readonly placeholder: WikiPrivatePlaceholder;
}

/**
 * What an administrator sees of a private page: no title and no text, only
 * that it exists, whose it is and where it is, and the way to delete it.
 */
export function WikiPrivatePlaceholderView({
  placeholder,
}: WikiPrivatePlaceholderViewProps): React.ReactElement {
  const { t } = useTranslation();
  const [isConfirming, setIsConfirming] = useState(false);

  return (
    <section
      aria-label={t("wiki.placeholder.label")}
      className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-2xl border border-dashed border-border p-10 text-center"
    >
      <p
        aria-hidden="true"
        className="-rotate-12 rounded-md border-4 border-destructive px-4 py-1 text-4xl font-black tracking-widest text-destructive"
      >
        {t("wiki.placeholder.stamp")}
      </p>
      <p className="text-sm text-muted-foreground">
        {t("wiki.placeholder.description")}
      </p>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-center gap-2">
          <dt className="font-medium">{t("wiki.placeholder.owner")}</dt>
          <dd>{placeholder.ownerName}</dd>
        </div>
        <div className="flex justify-center gap-2">
          <dt className="font-medium">{t("wiki.placeholder.address")}</dt>
          <dd className="pages-selectable font-mono">/wiki/{placeholder.id}</dd>
        </div>
      </dl>
      <Button variant="destructive" onClick={() => setIsConfirming(true)}>
        {t("wiki.placeholder.delete")}
      </Button>
      {isConfirming ? (
        <WikiActionDialog
          action="/wiki"
          description={t("wiki.placeholder.deleteDescription", {
            name: placeholder.ownerName,
          })}
          fields={{ intent: "delete-private-page", pageId: placeholder.id }}
          isDestructive
          submitLabel={t("wiki.placeholder.delete")}
          title={t("wiki.placeholder.deleteTitle")}
          onClose={() => setIsConfirming(false)}
        />
      ) : null}
    </section>
  );
}
