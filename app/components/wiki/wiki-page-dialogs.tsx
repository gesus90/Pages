import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { WikiActionDialog } from "@/app/components/wiki/wiki-action-dialog";
import { wikiPagePath } from "@/app/lib/wiki-tree";
import { WIKI_LIMITS } from "@/definition/Wiki";

import type { WikiOwnerCandidate, WikiPage } from "@/definition/Wiki";

interface PageDialogProps {
  readonly page: WikiPage;
  readonly onClose: () => void;
}

/** Asks for confirmation before a page and its subpages go to the trash. */
export function WikiDeleteDialog({
  page,
  onClose,
}: PageDialogProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <WikiActionDialog
      action="/wiki"
      description={t("wiki.dialog.delete.description")}
      fields={{ intent: "delete-page", pageId: page.id }}
      isDestructive
      submitLabel={t("wiki.dialog.delete.submit")}
      title={t("wiki.dialog.delete.title", { title: page.title })}
      onClose={onClose}
    />
  );
}

/** Copies a page, or saves a copy as a template. */
export function WikiDuplicateDialog({
  page,
  onClose,
  asTemplate = false,
}: PageDialogProps & { readonly asTemplate?: boolean }): React.ReactElement {
  const { t } = useTranslation();
  const [withChildren, setWithChildren] = useState(false);
  const key = asTemplate ? "template" : "duplicate";

  return (
    <WikiActionDialog
      action="/wiki"
      description={t(`wiki.dialog.${key}.description`)}
      fields={{
        intent: "duplicate-page",
        pageId: page.id,
        template: asTemplate ? "1" : "0",
        withChildren: withChildren ? "1" : "0",
      }}
      submitLabel={t(`wiki.dialog.${key}.submit`)}
      title={t(`wiki.dialog.${key}.title`)}
      onClose={onClose}
    >
      <label className="block text-sm font-medium" htmlFor="wiki-copy-title">
        {t("wiki.dialog.create.titleLabel")}
        <Input
          autoFocus
          className="mt-1"
          defaultValue={t("wiki.dialog.duplicate.copyOf", {
            title: page.title,
          })}
          id="wiki-copy-title"
          maxLength={WIKI_LIMITS.titleLength}
          name="title"
          required
        />
      </label>
      {asTemplate ? null : (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={withChildren}
            onChange={(event) => setWithChildren(event.target.checked)}
          />
          {t("wiki.dialog.duplicate.withChildren")}
        </label>
      )}
    </WikiActionDialog>
  );
}

/** Sets or clears the date until which a page counts as up to date. */
export function WikiCurrentUntilDialog({
  page,
  onClose,
}: PageDialogProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <WikiActionDialog
      action={wikiPagePath(page.id)}
      description={t("wiki.dialog.currentUntil.description")}
      fields={{ intent: "set-current-until" }}
      submitLabel={t("wiki.dialog.save")}
      title={t("wiki.dialog.currentUntil.title")}
      onClose={onClose}
    >
      <label className="block text-sm font-medium" htmlFor="wiki-current-until">
        {t("wiki.dialog.currentUntil.label")}
        <Input
          className="mt-1"
          defaultValue={page.currentUntil ?? ""}
          id="wiki-current-until"
          name="currentUntil"
          type="date"
        />
      </label>
    </WikiActionDialog>
  );
}

/** Hands a page over to another owner. */
export function WikiOwnerDialog({
  page,
  owners,
  onClose,
}: PageDialogProps & {
  readonly owners: readonly WikiOwnerCandidate[];
}): React.ReactElement {
  const { t } = useTranslation();
  const [ownerId, setOwnerId] = useState(page.ownerId);

  return (
    <WikiActionDialog
      action={wikiPagePath(page.id)}
      description={t("wiki.dialog.owner.description")}
      fields={{ intent: "set-owner", ownerId }}
      submitLabel={t("wiki.dialog.save")}
      title={t("wiki.dialog.owner.title")}
      onClose={onClose}
    >
      <Select
        ariaLabel={t("wiki.dialog.owner.label")}
        className="w-full"
        options={owners.map((owner) => ({
          label: owner.displayName,
          value: owner.id,
        }))}
        value={ownerId}
        onValueChange={setOwnerId}
      />
    </WikiActionDialog>
  );
}
