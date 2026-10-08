import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Select } from "@/app/components/ui/select";
import {
  formatMoveTarget,
  listMoveTargets,
  parseMoveTarget,
} from "@/app/lib/wiki-move-targets";

import type { WikiMoveRequest } from "@/app/components/wiki/use-wiki-drag";
import type { WikiActionResult } from "@/app/lib/wiki-actions/wiki-action-support.server";
import type { WikiNavigation, WikiVisibilityChange } from "@/definition/Wiki";

interface WikiMoveDialogProps {
  readonly navigation: WikiNavigation;
  /** The move to ask about; the person may pick another target. */
  readonly request: WikiMoveRequest;
  readonly onClose: () => void;
}

function Problem({
  result,
}: {
  readonly result: WikiActionResult | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();

  return result?.ok === false ? (
    <p className="text-sm text-destructive" role="alert">
      {t(`wiki.errors.${result.error}`)}
    </p>
  ) : null;
}

/** Asks where a page goes and tells how that changes who sees it. */
export function WikiMoveDialog({
  navigation,
  request,
  onClose,
}: WikiMoveDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const preview =
    useFetcher<WikiActionResult<{ change: WikiVisibilityChange }>>();
  const move = useFetcher<WikiActionResult>();
  const [target, setTarget] = useState(formatMoveTarget(request));
  const place = parseMoveTarget(target);
  const beforeId =
    target === formatMoveTarget(request) ? request.beforeId : null;
  const previewSubmit = preview.submit;
  const hasMoved = move.data?.ok === true;
  const pageId = request.pageId;
  const parentId = place.parentId ?? "";
  const projectId = place.projectId ?? "";
  const scope = place.scope;
  const fields = {
    beforeId: beforeId ?? "",
    pageId,
    parentId,
    projectId,
    scope,
  };

  useEffect(() => {
    void previewSubmit(
      {
        beforeId: beforeId ?? "",
        intent: "preview-move",
        pageId,
        parentId,
        projectId,
        scope,
      },
      { action: "/wiki", method: "post" },
    );
  }, [beforeId, pageId, parentId, previewSubmit, projectId, scope]);

  useEffect(() => {
    if (hasMoved) {
      onClose();
    }
  }, [hasMoved, onClose]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold">
          {t("wiki.dialog.move.title")}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {t("wiki.dialog.move.description")}
        </DialogDescription>
        <div className="mt-4 space-y-3">
          <Select
            ariaLabel={t("wiki.dialog.move.targetLabel")}
            className="w-full"
            options={listMoveTargets(navigation, request.pageId, {
              generalRoot: t("wiki.dialog.move.rootGeneral"),
              privateRoot: t("wiki.dialog.move.rootPrivate"),
              projectRoot: (name) =>
                t("wiki.dialog.move.rootProject", { name }),
            })}
            value={target}
            onValueChange={setTarget}
          />
          {preview.data?.ok === true ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t(`wiki.dialog.move.change.${preview.data.change}`)}
            </p>
          ) : null}
          <Problem result={preview.data} />
          <Problem result={move.data} />
        </div>
        <move.Form
          action="/wiki"
          className="mt-4 flex justify-end gap-2"
          method="post"
        >
          <input name="intent" type="hidden" value="move-page" />
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} name={name} type="hidden" value={value} />
          ))}
          <Button variant="ghost" onClick={onClose}>
            {t("wiki.dialog.cancel")}
          </Button>
          <Button disabled={preview.data?.ok !== true} type="submit">
            {t("wiki.dialog.move.submit")}
          </Button>
        </move.Form>
      </DialogContent>
    </Dialog>
  );
}
