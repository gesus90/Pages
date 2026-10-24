import { SquareTerminal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import {
  ControlRow,
  SettingsCard,
} from "@/app/components/settings/settings-layout";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { TERMINAL_SCREEN_READER_MODES } from "@/definition/Settings";

import type { SegmentedControlOption } from "@/app/components/ui/segmented-control";
import type { TerminalScreenReaderMode } from "@/definition/Settings";

interface TerminalCardProps {
  readonly screenReader: TerminalScreenReaderMode;
}

/** Renders how the remote console offers its screen to a screen reader. */
export function TerminalCard({
  screenReader,
}: TerminalCardProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const [mode, setMode] = useState(screenReader);
  const options: SegmentedControlOption<TerminalScreenReaderMode>[] =
    TERMINAL_SCREEN_READER_MODES.map((value) => ({
      label: t(`settings.terminal.screenReader.${value}`),
      value,
    }));

  function handleChange(next: TerminalScreenReaderMode): void {
    setMode(next);
    const formData = new FormData();
    formData.set("intent", "update-terminal-screen-reader");
    formData.set("terminalScreenReader", next);
    void submit(formData, { method: "post" });
  }

  return (
    <SettingsCard
      description={t("settings.terminal.description")}
      icon={<SquareTerminal className="size-4" aria-hidden="true" />}
      title={t("settings.terminal.title")}
    >
      <div className="flex flex-col gap-4">
        <ControlRow label={t("settings.terminal.screenReader.label")}>
          <SegmentedControl
            ariaLabel={t("settings.terminal.screenReader.label")}
            onValueChange={handleChange}
            options={options}
            value={mode}
          />
        </ControlRow>
        <p className="-mt-2 text-xs leading-relaxed text-muted-foreground">
          {t("settings.terminal.screenReader.hint")}
        </p>
      </div>
    </SettingsCard>
  );
}
