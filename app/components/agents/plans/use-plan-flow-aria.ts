import { useTranslation } from "react-i18next";

import type { AriaLabelConfig } from "@xyflow/react";

/** React Flow's built-in keyboard instructions and controls follow the current Pages language. */
export function usePlanFlowAria(): Partial<AriaLabelConfig> {
  const { t } = useTranslation();
  return {
    "node.a11yDescription.default": t("plans.flow.nodeKeys"),
    "node.a11yDescription.keyboardDisabled": t("plans.flow.nodeReadOnlyKeys"),
    "node.a11yDescription.ariaLiveMessage": ({ x, y }) =>
      t("plans.flow.nodeMoved", { x, y }),
    "edge.a11yDescription.default": t("plans.flow.edgeKeys"),
    "controls.ariaLabel": t("plans.flow.tools"),
    "controls.zoomIn.ariaLabel": t("plans.zoomIn"),
    "controls.zoomOut.ariaLabel": t("plans.zoomOut"),
    "controls.fitView.ariaLabel": t("plans.flow.fitView"),
    "minimap.ariaLabel": t("plans.flow.miniMap"),
  };
}
