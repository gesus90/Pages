import { Plus, Trash2 } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { MAXIMUM_REMOTE_ROOTS } from "@/definition/RemoteConnection";

import { REMOTE_FIELD_CLASS } from "./remote-field-style";

/**
 * The allowed directories of a connection: absolute paths on the machine in
 * which its workspace profiles must lie.
 *
 * @remarks
 * Without an entry only the SSH user's home `/home/<user>` is allowed, so
 * the hint names that directory for the user typed above.
 */
export function RemoteAllowedRoots(props: {
  readonly roots: readonly string[];
  readonly username: string;
  readonly onChange: (roots: readonly string[]) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const { roots, onChange } = props;
  const user = props.username.trim();
  const home = user ? `/home/${user}` : t("remote.dialog.rootsHomeUnknown");
  function update(index: number, root: string): void {
    onChange(
      roots.map((entry, position) => (position === index ? root : entry)),
    );
  }
  function remove(index: number): void {
    onChange(roots.filter((entry, position) => position !== index));
  }
  return (
    <fieldset className="min-w-0 space-y-2" aria-describedby={`${id}-hint`}>
      <legend className="text-sm font-medium">
        {t("remote.dialog.roots")}
      </legend>
      {roots.map((root, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            aria-label={t("remote.dialog.rootsEntry", { number: index + 1 })}
            maxLength={4096}
            spellCheck={false}
            autoComplete="off"
            placeholder="/srv/projects"
            className={`font-mono ${REMOTE_FIELD_CLASS}`}
            value={root}
            onChange={(event) => update(index, event.target.value)}
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("remote.dialog.rootsRemove", { number: index + 1 })}
            onClick={() => remove(index)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {t("remote.dialog.rootsHint", { home })}
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={roots.length >= MAXIMUM_REMOTE_ROOTS}
        onClick={() => onChange([...roots, ""])}
      >
        <Plus className="size-4" aria-hidden="true" />
        {t("remote.dialog.rootsAdd")}
      </Button>
    </fieldset>
  );
}
