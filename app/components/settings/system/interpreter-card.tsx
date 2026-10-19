import { CodeXml, Plus } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";

import { InterpreterTable } from "./interpreter-table";
import { useInterpreterProfiles } from "./use-interpreter-profiles";

import type { InterpreterSnapshot } from "@/definition/InterpreterProfile";

/** Loads profile details through the dedicated administrator-only resource. */
export function InterpreterCard(): React.ReactElement {
  const { t } = useTranslation();
  const { data: snapshot, load } = useFetcher<InterpreterSnapshot>();
  useEffect(() => {
    void load("/settings-api/interpreters");
  }, [load]);
  return (
    <SettingsCard
      title={t("settings.system.interpreters.title")}
      description={t("settings.system.interpreters.description")}
      icon={<CodeXml className="size-4" aria-hidden="true" />}
      className="min-w-0"
    >
      {snapshot ? (
        <InterpreterProfileEditor snapshot={snapshot} />
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {t("settings.system.interpreters.loading")}
        </p>
      )}
    </SettingsCard>
  );
}

function InterpreterProfileEditor({
  snapshot,
}: {
  readonly snapshot: InterpreterSnapshot;
}): React.ReactElement {
  const { t } = useTranslation();
  const editor = useInterpreterProfiles(snapshot);
  return (
    <>
      <InterpreterTable editor={editor} />
      <div className="mt-4 flex items-center justify-between gap-2">
        <Button
          size="icon"
          className="rounded-md"
          disabled={editor.isSaving || editor.rows.length >= 32}
          onClick={editor.add}
          aria-label={t("settings.system.interpreters.add")}
          title={t("settings.system.interpreters.add")}
        >
          <Plus className="size-4" aria-hidden="true" />
        </Button>
        <Button
          className="w-[104px] rounded-md disabled:opacity-40 xl:text-xs"
          disabled={!editor.canSave}
          onClick={() => {
            void editor.save();
          }}
        >
          {t("settings.system.interpreters.save")}
        </Button>
      </div>
      {editor.message ? (
        <p
          className={
            editor.message === "saved"
              ? "mt-2 text-xs text-success"
              : "mt-2 text-xs text-destructive"
          }
          role={editor.message === "saved" ? "status" : "alert"}
        >
          {t(`settings.system.interpreters.${editor.message}`)}
        </p>
      ) : null}
    </>
  );
}
