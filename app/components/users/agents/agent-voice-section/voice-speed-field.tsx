import { useId } from "react";
import { useTranslation } from "react-i18next";

import { AGENT_VOICE_SPEED } from "@/definition/SpeechSynthesis";

/**
 * Formats a speed in tenths as the slider shows it.
 *
 * @param tenths - The speed in tenths, such as 11.
 * @param language - The language of the page.
 * @returns For example "1,1×" in German.
 */
export function formatVoiceSpeed(tenths: number, language: string): string {
  const speed = new Intl.NumberFormat(language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(tenths / 10);
  return `${speed}×`;
}

/** The slider "Geschwindigkeit" from 0.5× to 2.0× in steps of 0.1 (PAGE-300). */
export function VoiceSpeedField({
  value,
  isDisabled,
  onChange,
}: {
  readonly value: number;
  readonly isDisabled: boolean;
  readonly onChange: (tenths: number) => void;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const id = useId();
  const { minimumTenths, maximumTenths } = AGENT_VOICE_SPEED;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {t("agentVoice.speed")}
      </label>
      <input
        id={id}
        type="range"
        className="w-full accent-primary disabled:cursor-not-allowed disabled:opacity-60"
        min={minimumTenths}
        max={maximumTenths}
        step={1}
        value={value}
        disabled={isDisabled}
        aria-valuetext={formatVoiceSpeed(value, i18n.language)}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
        <span>{formatVoiceSpeed(minimumTenths, i18n.language)}</span>
        <output htmlFor={id} className="font-semibold text-foreground">
          {formatVoiceSpeed(value, i18n.language)}
        </output>
        <span>{formatVoiceSpeed(maximumTenths, i18n.language)}</span>
      </div>
    </div>
  );
}
