import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { WikiNewPageForm } from "@/app/components/wiki/wiki-new-page-form";

import type { WikiTemplateChoice } from "@/app/components/wiki/wiki-new-page-form";
import type { WikiProjectArea } from "@/definition/Wiki";

export type { WikiTemplateChoice } from "@/app/components/wiki/wiki-new-page-form";

interface WikiNewPageDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly projects: readonly WikiProjectArea[];
  readonly templates: readonly WikiTemplateChoice[];
  /** Create below this page instead of in an area. */
  readonly parentId?: string;
}

/** The dialog that creates a page, in an area or below a page. */
export function WikiNewPageDialog({
  isOpen,
  onOpenChange,
  projects,
  templates,
  parentId,
}: WikiNewPageDialogProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold">
          {t("wiki.dialog.create.title")}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {t("wiki.dialog.create.description")}
        </DialogDescription>
        <WikiNewPageForm
          parentId={parentId}
          projects={projects}
          templates={templates}
        />
      </DialogContent>
    </Dialog>
  );
}

interface WikiNewPageButtonProps {
  readonly projects: readonly WikiProjectArea[];
  readonly templates: readonly WikiTemplateChoice[];
  /** Create below this page instead of in an area. */
  readonly parentId?: string;
  readonly label: string;
  readonly variant?: "default" | "outline" | "ghost";
}

/** A button that opens the dialog for a new page. */
export function WikiNewPageButton({
  projects,
  templates,
  parentId,
  label,
  variant = "default",
}: WikiNewPageButtonProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setIsOpen(true)}>
        <Plus aria-hidden="true" className="size-4" />
        {label}
      </Button>
      <WikiNewPageDialog
        isOpen={isOpen}
        parentId={parentId}
        projects={projects}
        templates={templates}
        onOpenChange={setIsOpen}
      />
    </>
  );
}
