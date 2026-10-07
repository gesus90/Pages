import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, useActionData, useNavigation } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";

import type { ProjectDetailActionResult } from "@/app/lib/project-actions/project-action-support.server";

interface ProjectLifecycleDialogProps {
  readonly projectId: string;
  readonly name: string;
  readonly kind: "archive" | "delete";
  readonly action?: string;
}

/** Requires explicit confirmation before archiving or permanently deleting a named project. */
export function ProjectLifecycleDialog({
  projectId,
  name,
  kind,
  action,
}: ProjectLifecycleDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const navigation = useNavigation();
  const outcome = useActionData<ProjectDetailActionResult | undefined>();
  const intent = `${kind}-project`;
  const pending =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === intent;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          {t(`projects.lifecycle.${kind}`)}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {t(`projects.lifecycle.${kind}Title`, { name })}
        </DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t(`projects.lifecycle.${kind}Hint`)}
        </DialogDescription>
        <Form method="post" action={action} className="mt-5">
          <input type="hidden" name="intent" value={intent} />
          <input type="hidden" name="projectId" value={projectId} />
          {outcome && !outcome.ok ? (
            <p
              role="alert"
              className="pages-selectable text-sm text-destructive"
            >
              {t(`projects.error.${outcome.error}`)}
            </p>
          ) : null}
          <footer className="mt-6 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">{t("projects.actions.cancel")}</Button>
            </DialogClose>
            <Button
              type="submit"
              variant={kind === "delete" ? "destructive" : "default"}
              isPending={pending}
            >
              {t(`projects.lifecycle.${kind}`)}
            </Button>
          </footer>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
