import { useTranslation } from "react-i18next";

import { InterpreterProfileRow } from "./interpreter-row";

import type { useInterpreterProfiles } from "./use-interpreter-profiles";

/** Keeps the four columns aligned; narrow screens scroll within the card. */
export function InterpreterTable({
  editor,
}: {
  readonly editor: ReturnType<typeof useInterpreterProfiles>;
}): React.ReactElement {
  const { t } = useTranslation();
  const { rows, saved, isSaving, update, checkProfile } = editor;
  return (
    <div
      className="pages-thin-scrollbar relative overflow-x-auto rounded-md"
      role="region"
      aria-label={t("settings.system.interpreters.title")}
      tabIndex={0}
    >
      <table
        className="w-full min-w-[450px] table-fixed border-collapse"
        aria-label={t("settings.system.interpreters.title")}
      >
        <colgroup>
          <col className="w-[25.5%]" />
          <col className="w-[13%]" />
          <col />
          <col className="w-20" />
        </colgroup>
        <thead>
          <tr className="h-7 border-b border-border text-left text-xs font-normal text-muted-foreground">
            {["profile", "version", "path", "status"].map((column) => (
              <th
                key={column}
                scope="col"
                className={
                  column === "status"
                    ? "align-top text-center font-normal"
                    : "align-top font-normal"
                }
              >
                {t(`settings.system.interpreters.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <InterpreterProfileRow
              key={row.profile.id}
              row={row}
              savedPath={
                saved.profiles.find((profile) => profile.id === row.profile.id)
                  ?.path
              }
              isDuplicate={rows.some(
                (other) =>
                  other.profile.id !== row.profile.id &&
                  other.profile.name.trim().toLocaleLowerCase("en") ===
                    row.profile.name.trim().toLocaleLowerCase("en"),
              )}
              isSaving={isSaving}
              update={update}
              check={checkProfile}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
