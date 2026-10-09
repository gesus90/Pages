import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { isApiProvider } from "@/definition/AgentConnection";
import { supportsModelCatalog } from "@/definition/AgentModelCatalog";

import { AgentReasoningField } from "./agent-reasoning-field";

import type {
  AgentCatalogModel,
  AgentModelCatalog,
} from "@/definition/AgentModelCatalog";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { AgentForm } from "./use-agent-form";
import type { AgentModelAvailability } from "./use-model-availability";

// Model IDs never contain spaces, so this option value cannot collide with one.
const MANUAL_OPTION = "manual model id";

// Without these states, a manual model ID is the only way to choose a model.
const FALLBACK_STATES = new Set(["manualOnly", "failed", "pending"]);

function modelHintKey(provider: AgentProviderId): string {
  if (!isApiProvider(provider)) return "modelCliHint";
  return supportsModelCatalog(provider) ? "modelHint" : "modelManualHint";
}

/** Explains a missing model list; `null` once the catalog offers models. */
function modelStateKey(
  catalog: AgentModelCatalog | undefined,
  availability: AgentModelAvailability,
  isCli: boolean,
): string | null {
  if (catalog === undefined) return "manualOnly";
  if (catalog.models.length > 0) return null;
  if (availability.isLoading) return "loading";
  if (!availability.isUnlocked) return isCli ? "afterLogin" : "afterAccess";
  return catalog.errorCode ? "failed" : "pending";
}

function ModelSearchSelect({
  form,
  models,
  selected,
  isManual,
  onSelect,
}: {
  readonly form: AgentForm;
  readonly models: readonly AgentCatalogModel[];
  readonly selected: AgentCatalogModel | undefined;
  readonly isManual: boolean;
  readonly onSelect: (value: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const filtered = models.filter((model) =>
    `${model.id} ${model.name}`.toLowerCase().includes(query),
  );
  // Keep the chosen model listed while the search filters it out.
  const visibleModels =
    selected && !filtered.includes(selected)
      ? [selected, ...filtered]
      : filtered;
  const isCli = !isApiProvider(form.fields.provider);
  const options = [
    {
      value: "",
      label: t(
        isCli ? "settings.agents.cliDefault" : "settings.agents.catalog.choose",
      ),
    },
    ...visibleModels.map((model) => ({
      value: model.id,
      label: `${model.name} (${model.id})${model.isFree ? ` · ${t("settings.agents.catalog.free")}` : ""}`,
    })),
    { value: MANUAL_OPTION, label: t("settings.agents.catalog.otherModel") },
  ];
  return (
    <>
      <label className="text-sm font-medium" htmlFor="agent-model-search">
        {t("settings.agents.catalog.search")}
      </label>
      <Input
        id="agent-model-search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        maxLength={200}
      />
      <label
        className="block text-sm font-medium"
        htmlFor="agent-model-selection"
      >
        {t("settings.agents.model")}
      </label>
      <Select
        id="agent-model-selection"
        value={isManual ? MANUAL_OPTION : (selected?.id ?? "")}
        options={options}
        ariaLabel={t("settings.agents.model")}
        onValueChange={onSelect}
        disabled={form.isSaving}
        className="w-full"
      />
      <p className="text-xs text-muted-foreground">
        {t("settings.agents.catalog.count", {
          count: filtered.length,
          total: models.length,
        })}
      </p>
    </>
  );
}

function ManualModelInput({
  form,
}: {
  readonly form: AgentForm;
}): React.ReactElement {
  const { t } = useTranslation();
  const hasError =
    form.error === "test_model_invalid" || form.error === "test_model_required";
  return (
    <>
      <label className="text-sm font-medium" htmlFor="agent-model">
        {t("settings.agents.modelId")}
      </label>
      <Input
        id="agent-model"
        value={form.fields.testModel}
        onChange={(event) => {
          form.setField("testModel", event.target.value);
          form.setField("reasoningEffort", "");
        }}
        maxLength={200}
        spellCheck={false}
        aria-invalid={hasError}
        aria-describedby={hasError ? "agent-model-error" : "agent-model-hint"}
      />
      <p id="agent-model-hint" className="text-xs text-muted-foreground">
        {t(`settings.agents.${modelHintKey(form.fields.provider)}`)}
      </p>
      {hasError ? (
        <p id="agent-model-error" className="text-xs text-destructive">
          {t(`settings.agents.error.${form.error}`)}
        </p>
      ) : null}
    </>
  );
}

function ModelSection({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">
        {t("settings.agents.modelSection")}
      </h3>
      {children}
    </section>
  );
}

interface ModelDisplay {
  readonly models: readonly AgentCatalogModel[];
  readonly selected: AgentCatalogModel | undefined;
  readonly isManual: boolean;
  readonly stateKey: string | null;
  readonly showsManualInput: boolean;
  readonly showsReasoning: boolean;
  readonly isCliDefault: boolean;
  /** An API connection whose list offers models but which has none chosen. */
  readonly isUnchosen: boolean;
}

/** What the model section shows for the current form, list and access state. */
function modelDisplay(
  form: AgentForm,
  catalog: AgentModelCatalog | undefined,
  availability: AgentModelAvailability,
  isManualChoice: boolean,
): ModelDisplay {
  const models = catalog?.models ?? [];
  const selected = models.find((model) => model.id === form.fields.testModel);
  // A saved ID the list does not contain is shown as a manual entry.
  const isManual =
    isManualChoice || (form.fields.testModel !== "" && !selected);
  const isCli = !isApiProvider(form.fields.provider);
  const stateKey = modelStateKey(catalog, availability, isCli);
  const hasFallback = stateKey !== null && FALLBACK_STATES.has(stateKey);
  return {
    models,
    selected,
    isManual,
    stateKey,
    showsManualInput: hasFallback || (stateKey === null && isManual),
    showsReasoning: stateKey === null || hasFallback,
    isCliDefault: isCli && form.fields.testModel === "" && !isManual,
    isUnchosen:
      stateKey === null && !isCli && form.fields.testModel === "" && !isManual,
  };
}

function ModelChoice({
  form,
  catalog,
  availability,
}: {
  readonly form: AgentForm;
  readonly catalog: AgentModelCatalog | undefined;
  readonly availability: AgentModelAvailability;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isManualChoice, setIsManualChoice] = useState(false);
  const display = modelDisplay(form, catalog, availability, isManualChoice);
  function selectModel(value: string): void {
    setIsManualChoice(value === MANUAL_OPTION);
    if (value === MANUAL_OPTION) return;
    const next = display.models.find((model) => model.id === value);
    form.setField("testModel", value);
    if (!next?.reasoningEfforts.includes(form.fields.reasoningEffort))
      form.setField("reasoningEffort", "");
  }
  return (
    <>
      {display.stateKey ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t(`settings.agents.modelState.${display.stateKey}`)}
        </p>
      ) : (
        <ModelSearchSelect
          form={form}
          models={display.models}
          selected={display.selected}
          isManual={display.isManual}
          onSelect={selectModel}
        />
      )}
      {display.isUnchosen ? (
        <p className="text-xs text-muted-foreground">
          {t("settings.agents.catalog.noDefault")}
        </p>
      ) : null}
      {display.selected?.isFree ? (
        <span className="inline-flex rounded-full bg-success-subtle px-2 py-0.5 text-xs font-medium text-success">
          {t("settings.agents.catalog.free")}
        </span>
      ) : null}
      {display.showsManualInput ? <ManualModelInput form={form} /> : null}
      {display.showsReasoning ? (
        <AgentReasoningField
          form={form}
          model={display.selected}
          isCliDefault={display.isCliDefault}
        />
      ) : null}
    </>
  );
}

/**
 * Offers the model and reasoning effort of a saved connection once its access
 * is confirmed; manual IDs remain the fallback without a usable model list.
 */
export function AgentModelField({
  form,
  catalog,
  availability,
}: {
  readonly form: AgentForm;
  readonly catalog: AgentModelCatalog | undefined;
  readonly availability: AgentModelAvailability;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ModelSection>
      {availability.isExisting ? (
        <ModelChoice
          form={form}
          catalog={catalog}
          availability={availability}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("settings.agents.modelState.afterSave")}
        </p>
      )}
    </ModelSection>
  );
}
