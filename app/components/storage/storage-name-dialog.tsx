import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";

import type { ReactNode } from "react";

import type { StorageNamePurpose } from "./use-storage-actions";

interface StorageNameDialogProps {
  /** What the name is for; `null` keeps the dialog closed. */
  readonly purpose: StorageNamePurpose | null;
  /** The current name of a renamed entry, else empty. */
  readonly initialName: string;
  readonly isBusy: boolean;
  readonly error: ReactNode;
  readonly onSubmit: (name: string) => void;
  readonly onCancel: () => void;
}

function NameForm({
  purpose,
  initialName,
  isBusy,
  error,
  onSubmit,
  onCancel,
}: StorageNameDialogProps & {
  readonly purpose: StorageNamePurpose;
}): React.ReactElement {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const trimmedName = name.trim();
  const isUnchanged = purpose === "rename" && trimmedName === initialName;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (trimmedName !== "" && !isUnchanged) onSubmit(trimmedName);
  }

  return (
    <form className="mt-4 flex flex-col gap-3" onSubmit={handleSubmit}>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
        {t("storage.name.label")}
        <Input
          autoFocus
          maxLength={255}
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
      </label>
      {error}
      <footer className="mt-3 flex justify-end gap-2">
        <Button onClick={onCancel} type="button" variant="ghost">
          {t("storage.actions.cancel")}
        </Button>
        <Button
          disabled={trimmedName === "" || isUnchanged}
          isPending={isBusy}
          type="submit"
        >
          {t(`storage.name.submit.${purpose}`)}
        </Button>
      </footer>
    </form>
  );
}

/** Asks the name of a new folder or the new name of an entry. */
export function StorageNameDialog(
  props: StorageNameDialogProps,
): React.ReactElement {
  const { t } = useTranslation();
  const { purpose, onCancel } = props;

  function handleOpenChange(isOpen: boolean): void {
    if (!isOpen) onCancel();
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={purpose !== null}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {purpose === null ? null : t(`storage.name.title.${purpose}`)}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t("storage.name.label")}
        </DialogDescription>
        {purpose === null ? null : <NameForm {...props} purpose={purpose} />}
      </DialogContent>
    </Dialog>
  );
}
