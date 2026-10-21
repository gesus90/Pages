import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AdminButton, AdminField } from "./pica-admin-controls";

import type { AdminSectionProps } from "./pica-admin-controls";

/** Keeps browser task inputs separate from file edits and renders explicit session actions. */
export function PicaAdminBrowserSection({
  isBusy,
  run,
}: AdminSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const [task, setTask] = useState("");
  const [target, setTarget] = useState("");
  const [isLocal, setIsLocal] = useState(false);
  const [selector, setSelector] = useState("");
  const [text, setText] = useState("");
  function action(kind: string): void {
    void run("admin_browser_action", {
      action: kind,
      selector: selector || null,
      text: text || null,
    });
  }
  function open(): void {
    void run("admin_browser_open", {
      task,
      url: isLocal ? null : target,
      file: isLocal ? target : null,
    });
  }
  return (
    <fieldset
      disabled={isBusy}
      className="space-y-3 rounded-xl border border-border bg-surface p-5"
    >
      <legend className="px-2 font-semibold">{t("picaAdmin.browser")}</legend>
      <AdminField label={t("picaAdmin.task")} value={task} onChange={setTask} />
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={isLocal}
          onChange={(event) => setIsLocal(event.target.checked)}
        />
        {t("picaAdmin.local")}
      </label>
      <AdminField
        label={t("picaAdmin.target")}
        value={target}
        onChange={setTarget}
      />
      <div className="flex flex-wrap gap-2">
        <AdminButton onClick={open}>{t("picaAdmin.open")}</AdminButton>
        <AdminButton onClick={() => action("view")}>
          {t("picaAdmin.view")}
        </AdminButton>
        <AdminButton onClick={() => action("close")}>
          {t("picaAdmin.close")}
        </AdminButton>
      </div>
      <AdminField
        label={t("picaAdmin.selector")}
        value={selector}
        onChange={setSelector}
      />
      <AdminField label={t("picaAdmin.text")} value={text} onChange={setText} />
      <div className="flex gap-2">
        <AdminButton onClick={() => action("click")}>
          {t("picaAdmin.click")}
        </AdminButton>
        <AdminButton onClick={() => action("fill")}>
          {t("picaAdmin.fill")}
        </AdminButton>
      </div>
    </fieldset>
  );
}
