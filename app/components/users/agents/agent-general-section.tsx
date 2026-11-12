import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/app/components/agents/model-picker";
import {
  ModelFieldRow,
  ReasoningField,
} from "@/app/components/agents/model-picker/model-field";
import { PersonColorPicker } from "@/app/components/common/person-color-picker";
import { UserAvatar } from "@/app/components/common/user-avatar";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { reasoningOptions } from "@/app/lib/reasoning-options";
import { modelsOfSameTarget } from "@/definition/AgentReasoningChoice";

import type { AgentDraft, AgentDraftChange } from "./agent-draft";
import type { Department, UserRole } from "@/definition/Authorization";
import type { PageAgentModel } from "@/definition/PageAgent";

const LABEL_CLASS_NAME = "text-sm font-medium text-foreground";

interface AgentGeneralSectionProps {
  readonly draft: AgentDraft;
  readonly onChange: AgentDraftChange;
  readonly models: readonly PageAgentModel[];
  readonly roles: readonly UserRole[];
  readonly departments: readonly Department[];
  /** The address of the image to show: a picked file, or the stored image. */
  readonly imageUrl: string | null;
  readonly onImage: (file: File) => void;
  readonly savedModel: string;
  readonly isDisabled: boolean;
}

function TextField({
  label,
  value,
  onChange,
  isDisabled,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly isDisabled: boolean;
  readonly hint?: string;
}): React.ReactElement {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className={LABEL_CLASS_NAME} htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        value={value}
        disabled={isDisabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Image, upload and the person color of the agent. */
function AgentImageRow({
  draft,
  onChange,
  imageUrl,
  onImage,
  isDisabled,
}: Pick<
  AgentGeneralSectionProps,
  "draft" | "onChange" | "imageUrl" | "onImage" | "isDisabled"
>): React.ReactElement {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap items-center gap-5">
      <UserAvatar
        size="xl"
        name={draft.displayName || "?"}
        avatarColor={draft.avatarColor}
        avatarType={imageUrl ? "image" : "initials"}
        avatarImageUrl={imageUrl}
      />
      <div className="flex flex-col gap-3">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) onImage(file);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={isDisabled}
          onClick={() => input.current?.click()}
        >
          {t("agentEmployees.fields.uploadImage")}
        </Button>
        <span className={LABEL_CLASS_NAME}>
          {t("agentEmployees.fields.color")}
        </span>
        <PersonColorPicker
          value={draft.avatarColor}
          onChange={(color) => onChange("avatarColor", color)}
          label={t("agentEmployees.fields.color")}
          isDisabled={isDisabled}
          canClear
        />
      </div>
    </div>
  );
}

/** Model with provider mark and reasoning, the shared model choice. */
function AgentModelRow({
  draft,
  onChange,
  models,
  savedModel,
  isDisabled,
}: Pick<
  AgentGeneralSectionProps,
  "draft" | "onChange" | "models" | "savedModel" | "isDisabled"
>): React.ReactElement {
  const { t } = useTranslation();
  const model = models.find((entry) => entry.id === draft.modelKey);
  const options = reasoningOptions({
    model,
    modelName: model?.modelName ?? model?.name ?? "",
    siblings: modelsOfSameTarget(models, model),
    current: draft.reasoningEffort,
    defaultLabel: t("pageAgents.defaultReasoning"),
    translate: t,
  });
  function selectModel(key: string): void {
    onChange("modelKey", key);
    onChange("reasoningEffort", "");
  }
  return (
    <ModelFieldRow>
      <ModelPicker
        value={draft.modelKey}
        models={models}
        savedModel={savedModel}
        disabled={isDisabled}
        placeholder={t("agentEmployees.fields.chooseModel")}
        emptyLabel={t("agentEmployees.fields.noModels")}
        onChange={selectModel}
      />
      <ReasoningField
        value={draft.reasoningEffort}
        options={options}
        disabled={isDisabled}
        onChange={(effort) => onChange("reasoningEffort", effort)}
      />
    </ModelFieldRow>
  );
}

/** Role without an administrator option, and the departments. */
function AgentRightsFields({
  draft,
  onChange,
  roles,
  departments,
  isDisabled,
}: Pick<
  AgentGeneralSectionProps,
  "draft" | "onChange" | "roles" | "departments" | "isDisabled"
>): React.ReactElement {
  const { t } = useTranslation();
  const roleId = useId();
  function toggleDepartment(id: string): void {
    onChange(
      "departments",
      draft.departments.includes(id)
        ? draft.departments.filter((entry) => entry !== id)
        : [...draft.departments, id],
    );
  }
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">
        {t("agentEmployees.fields.rights")}
      </h3>
      <label className={LABEL_CLASS_NAME} htmlFor={roleId}>
        {t("agentEmployees.fields.role")}
      </label>
      <Select
        id={roleId}
        ariaLabel={t("agentEmployees.fields.role")}
        className="w-full"
        value={draft.roleId}
        disabled={isDisabled}
        placeholder={t("agentEmployees.fields.chooseRole")}
        onValueChange={(value) => onChange("roleId", value)}
        options={roles.map((role) => ({ value: role.id, label: role.name }))}
      />
      <fieldset className="mt-2 flex flex-col gap-2">
        <legend className={`${LABEL_CLASS_NAME} mb-2`}>
          {t("users.sections.departments")}
        </legend>
        {departments.map((department) => (
          <label
            key={department.id}
            className="flex items-center gap-2 text-sm"
          >
            <Checkbox
              checked={draft.departments.includes(department.id)}
              disabled={isDisabled}
              onChange={() => toggleDepartment(department.id)}
            />
            {department.name}
          </label>
        ))}
        {departments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("users.noDepartments")}
          </p>
        ) : null}
      </fieldset>
    </section>
  );
}

/**
 * The tab "Allgemein" of the agent panel (PAGE-266): image and color, name,
 * username, job title, model with reasoning, role and departments; the
 * access level has a tab of its own (PAGE-303).
 */
export function AgentGeneralSection(
  props: AgentGeneralSectionProps,
): React.ReactElement {
  const { t } = useTranslation();
  const { draft, onChange, isDisabled } = props;
  return (
    <div className="flex flex-col gap-5">
      <AgentImageRow {...props} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("agentEmployees.fields.name")}
          value={draft.displayName}
          onChange={(value) => onChange("displayName", value)}
          isDisabled={isDisabled}
        />
        <TextField
          label={t("agentEmployees.fields.username")}
          value={draft.username}
          onChange={(value) => onChange("username", value)}
          isDisabled={isDisabled}
        />
      </div>
      <TextField
        label={t("agentEmployees.fields.position")}
        value={draft.position}
        onChange={(value) => onChange("position", value)}
        isDisabled={isDisabled}
        hint={t("agentEmployees.fields.positionHint")}
      />
      <AgentModelRow {...props} />
      <AgentRightsFields {...props} />
    </div>
  );
}
