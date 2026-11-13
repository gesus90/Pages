import { useId } from "react";
import { useTranslation } from "react-i18next";

import {
  CONVERSATION_MAXIMUM_RESPONDERS_RANGE,
  CONVERSATION_THRESHOLD_RANGE,
} from "@/definition/ConversationDecision";

import type { ConversationDecisionRules } from "@/definition/ConversationDecision";

/** The sliders in their order, with the range and the unit of each. */
const RULE_SLIDERS = [
  { rule: "answerThreshold", range: CONVERSATION_THRESHOLD_RANGE, step: 5 },
  {
    rule: "responsibilityThreshold",
    range: CONVERSATION_THRESHOLD_RANGE,
    step: 5,
  },
  { rule: "secondThreshold", range: CONVERSATION_THRESHOLD_RANGE, step: 5 },
  {
    rule: "maximumResponders",
    range: CONVERSATION_MAXIMUM_RESPONDERS_RANGE,
    step: 1,
  },
] as const;

interface RuleSliderProps {
  readonly rule: (typeof RULE_SLIDERS)[number]["rule"];
  readonly range: { readonly minimum: number; readonly maximum: number };
  readonly step: number;
  readonly value: number;
  readonly isDisabled: boolean;
  readonly onChange: (value: number) => void;
}

function RuleSlider({
  rule,
  range,
  step,
  value,
  isDisabled,
  onChange,
}: RuleSliderProps): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const isPercent = rule !== "maximumResponders";
  const shown = isPercent ? `${String(value)} %` : String(value);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {t(`decisionRules.${rule}.label`)}
        </label>
        <output
          htmlFor={id}
          className="text-sm font-semibold text-foreground tabular-nums"
        >
          {shown}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className="w-full accent-primary disabled:cursor-not-allowed disabled:opacity-60"
        min={range.minimum}
        max={range.maximum}
        step={step}
        value={value}
        disabled={isDisabled}
        aria-valuetext={shown}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <p className="text-xs text-muted-foreground">
        {t(`decisionRules.${rule}.hint`)}
      </p>
    </div>
  );
}

interface DecisionRulesFieldsProps {
  readonly rules: ConversationDecisionRules;
  /** Switches every slider off, such as in the mode "Nur @" or without the right to change. */
  readonly isDisabled: boolean;
  readonly onChange: (rules: ConversationDecisionRules) => void;
}

/**
 * The three thresholds and the most answering agents as sliders (PAGE-379):
 * the answer threshold, the responsibility threshold, the second threshold and
 * the maximum number of answering agents.
 *
 * @remarks
 * The instance setting and the popup "Wer antwortet?" of a group use the same
 * fields; the server checks the ranges again.
 */
export function DecisionRulesFields({
  rules,
  isDisabled,
  onChange,
}: DecisionRulesFieldsProps): React.ReactElement {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {RULE_SLIDERS.map(({ rule, range, step }) => (
        <RuleSlider
          key={rule}
          rule={rule}
          range={range}
          step={step}
          value={rules[rule]}
          isDisabled={isDisabled}
          onChange={(value) => onChange({ ...rules, [rule]: value })}
        />
      ))}
    </div>
  );
}
