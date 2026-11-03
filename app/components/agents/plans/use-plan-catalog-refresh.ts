import { useModelCatalogRefresh } from "@/app/components/agents/model-picker/use-model-catalog-refresh";

import type {
  ModelCatalogRefresh,
  ModelCatalogRefreshState,
} from "@/app/components/agents/model-picker/use-model-catalog-refresh";

/** An authorized loader's baseline for conditional context refresh, without another catalog payload. */
export type PlanCatalogRefresh = ModelCatalogRefresh;

/** Refreshes changed registry and runner facts while preserving the editor's unsaved draft. */
export function usePlanCatalogRefresh(
  input?: PlanCatalogRefresh,
): ModelCatalogRefreshState {
  return useModelCatalogRefresh(input);
}
