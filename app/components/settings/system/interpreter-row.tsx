import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { interpreterProfileSchema } from "@/definition/InterpreterProfile";

import { InterpreterStatus } from "./interpreter-status";
import { useAutomaticInterpreterCheck } from "./use-interpreter-check";

import type { InterpreterRow } from "./interpreter-editor-state";

interface InterpreterProfileRowProps {
  readonly row: InterpreterRow;
  readonly savedPath?: string;
  readonly isSaving: boolean;
  readonly isDuplicate: boolean;
  readonly update: (id: string, field: "name" | "path", text: string) => void;
  readonly check: (id: string) => Promise<void>;
}

function profileVersion(row: InterpreterRow): string {
  if (!row.check || row.check.path !== row.profile.path || row.isChecking)
    return "—";
  return row.check.version ?? "—";
}

/** Renders one bounded row; long names and paths remain inside their columns. */
export function InterpreterProfileRow({
  row,
  savedPath,
  isSaving,
  isDuplicate,
  update,
  check,
}: InterpreterProfileRowProps): React.ReactElement {
  const { t } = useTranslation();
  useAutomaticInterpreterCheck(row, savedPath, check);
  const { profile } = row;
  const isValid =
    interpreterProfileSchema.safeParse(profile).success && !isDuplicate;
  const hasError =
    row.check?.path === profile.path && row.check.status === "error";
  const version = profileVersion(row);
  const error = row.check;
  const errorId = `interpreter-error-${profile.id}`;
  return (
    <tr className="h-[52px] border-b border-border text-xs">
      <td className="py-2 pr-2">
        <Input
          size="sm"
          value={profile.name}
          disabled={isSaving}
          maxLength={80}
          className={
            savedPath === undefined
              ? "h-11 min-w-0 rounded-md border border-field-border bg-background px-2 shadow-none sm:h-8 xl:h-8 xl:px-2"
              : "h-11 min-w-0 rounded-md bg-transparent px-0 shadow-none sm:h-8 xl:h-8 xl:px-0"
          }
          aria-label={t("settings.system.interpreters.profileName")}
          aria-invalid={isDuplicate || undefined}
          title={profile.name}
          onChange={(event) => update(profile.id, "name", event.target.value)}
        />
      </td>
      <td
        className="overflow-hidden text-ellipsis whitespace-nowrap pr-2"
        title={version}
      >
        {version}
      </td>
      <td className="py-2 pr-2">
        <Input
          size="sm"
          value={profile.path}
          disabled={isSaving}
          maxLength={4096}
          spellCheck={false}
          className="h-11 min-w-0 rounded-md shadow-none border border-field-border bg-background px-2 font-mono sm:h-8 xl:h-8 xl:px-2"
          aria-label={t("settings.system.interpreters.programPath", {
            name: profile.name,
          })}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? errorId : undefined}
          title={profile.path}
          onChange={(event) => update(profile.id, "path", event.target.value)}
        />
        {hasError ? (
          <span id={errorId} className="sr-only">
            {t(
              `settings.system.interpreters.errors.${error?.error ?? "failed"}`,
            )}{" "}
            {error?.diagnostic}
          </span>
        ) : null}
      </td>
      <td className="py-2 text-center">
        <InterpreterStatus
          row={row}
          canCheck={isValid && !isSaving}
          onCheck={() => {
            void check(profile.id);
          }}
        />
      </td>
    </tr>
  );
}
