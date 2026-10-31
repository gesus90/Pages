import { openCodeProviderLabel } from "@/app/components/settings/agents/pica-model-options";
import {
  connectionMark,
  ProviderIcon,
} from "@/app/components/settings/agents/provider-icon";
import { openCodeModelProvider } from "@/definition/AgentConnection";

import type { PageAgentModel } from "@/definition/PageAgent";
import type { TFunction } from "i18next";

/** How a plan's model choices name a model: its way of running, its provider icon and whether it is free. */
interface PlanModelDisplay {
  readonly label: string;
  readonly icon: React.ReactNode;
  /** " · Free" for a model whose catalog states a price of zero, otherwise empty. */
  readonly free: string;
}

/**
 * Names a model in the plan editor's choices.
 *
 * @param model - A local or remote model choice.
 * @param translate - Translates provider names and the free mark.
 * @returns An OpenCode model as "opencode · provider · model", after the
 * remote connection and workspace it runs on; any other model under its
 * existing name.
 */
export function planModelDisplay(
  model: PageAgentModel,
  translate: TFunction,
): PlanModelDisplay {
  const isOpenCode = model.provider === "opencode";
  return {
    label: isOpenCode
      ? `${model.targetName ? `${model.targetName} / ` : ""}opencode · ${openCodeProviderLabel(model, translate)} · ${model.modelName ?? model.name}`
      : model.name,
    icon: (
      <ProviderIcon
        provider={
          isOpenCode
            ? openCodeModelProvider(model.model)
            : connectionMark(model.provider)
        }
      />
    ),
    free: model.isFree ? ` · ${translate("settings.agents.freeBadge")}` : "",
  };
}
