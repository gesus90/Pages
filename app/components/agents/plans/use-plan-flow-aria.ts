import { useTranslation } from "react-i18next";

import type { AriaLabelConfig } from "@xyflow/react";

/** React Flow's built-in keyboard instructions follow the current Pages language. */
export function usePlanFlowAria(): Partial<AriaLabelConfig> {
  const { t } = useTranslation();
  return {
    "node.a11yDescription.default": t("plans.flow.nodeKeys"),
    "node.a11yDescription.keyboardDisabled": t("plans.flow.nodeReadOnlyKeys"),
    "node.a11yDescription.ariaLiveMessage": ({ x, y }) =>
      t("plans.flow.nodeMoved", { x, y }),
    "edge.a11yDescription.default": t("plans.flow.edgeKeys"),
  };
}
