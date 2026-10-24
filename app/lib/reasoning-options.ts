import { reasoningChoices } from "@/definition/AgentReasoningChoice";

import type { Select } from "@/app/components/ui/select";
import type { ReasoningSource } from "@/definition/AgentReasoningChoice";
import type { TFunction } from "i18next";

/** The choices of a reasoning select. */
export type ReasoningSelectOptions = React.ComponentProps<
  typeof Select
>["options"];

interface ReasoningOptionsInput {
  /** The chosen model; `undefined` while none is chosen or the saved one is gone. */
  readonly model: ReasoningSource | undefined;
  /** How the model is named in a choice, such as `Sonnet 5.5`. */
  readonly modelName: string;
  /** The models of the same target; together they say which levels exist at all. */
  readonly siblings: readonly ReasoningSource[];
  /** The saved or chosen level; an empty value stands for the default. */
  readonly current: string | null;
  readonly defaultLabel: string;
  readonly translate: TFunction;
}

/**
 * The reasoning levels of a model choice, including those it does not support.
 *
 * @param input - The chosen model, its target's models and the current level.
 * @returns The default and every level the target reports. A level the chosen
 * model lacks is disabled and says so; a saved level that is not offered at
 * all stays in the list as a disabled, marked entry instead of vanishing.
 *
 * @remarks
 * Only levels a CLI or provider reports appear: nothing is added for a
 * level such as `ultra` unless the target lists it for some model.
 */
export function reasoningOptions(
  input: ReasoningOptionsInput,
): ReasoningSelectOptions {
  const { current, translate } = input;
  const choices = reasoningChoices(input.model, input.siblings);
  const options: ReasoningSelectOptions[number][] = [
    { value: "", label: input.defaultLabel },
  ];
  for (const { effort, isSupported } of choices) {
    if (isSupported) {
      options.push({ value: effort, label: effort });
      continue;
    }
    options.push({
      value: effort,
      label:
        effort === current
          ? `${effort} · ${translate("picaSettings.unsupportedEffort")}`
          : effort,
      disabled: true,
      description: translate("reasoningChoice.unsupported", {
        model: input.modelName,
      }),
    });
  }
  if (current && !choices.some((choice) => choice.effort === current))
    options.push({
      value: current,
      label: `${current}${input.model ? ` · ${translate("picaSettings.unsupportedEffort")}` : ""}`,
      disabled: true,
    });
  return options;
}
