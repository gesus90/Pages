import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import {
  AGENT_DOCUMENT_LIMITS,
  AGENT_INSTRUCTION_TEMPLATES,
} from "@/definition/AgentEmployee";

import type { AgentInstructionTemplate } from "@/definition/AgentEmployee";

const DOCUMENT_CLASS_NAME = "min-h-96 font-mono text-[13px] leading-relaxed";

interface DocumentFieldProps {
  readonly title: string;
  readonly description: string;
  readonly value: string;
  readonly maximum: number;
  readonly onChange: (value: string) => void;
  readonly isDisabled: boolean;
}

/** One Markdown document with its length against the fixed limit. */
function DocumentField({
  title,
  description,
  value,
  maximum,
  onChange,
  isDisabled,
}: DocumentFieldProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const id = useId();
  const length = Array.from(value).length;
  const format = new Intl.NumberFormat(i18n.language);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-sm font-semibold" htmlFor={id}>
          {title}
        </label>
        <span
          className={
            length > maximum
              ? "text-xs tabular-nums text-destructive"
              : "text-xs tabular-nums text-muted-foreground"
          }
        >
          {t("agentEmployees.documents.length", {
            count: length,
            length: format.format(length),
            maximum: format.format(maximum),
          })}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
      <Textarea
        id={id}
        className={DOCUMENT_CLASS_NAME}
        value={value}
        disabled={isDisabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        spellCheck={false}
      />
    </div>
  );
}

/** The tab "Persönlichkeit": `SOUL.md`, who the agent is (PAGE-266). */
export function AgentSoulSection({
  value,
  onChange,
  isDisabled,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly isDisabled: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <DocumentField
      title="SOUL.md"
      description={t("agentEmployees.documents.soulDescription")}
      value={value}
      maximum={AGENT_DOCUMENT_LIMITS.soulCharacters}
      onChange={onChange}
      isDisabled={isDisabled}
    />
  );
}

/**
 * The tab "Aufgabe": `AGENT.md`, what the agent does (PAGE-266).
 *
 * @remarks
 * A template fills the field once; the text stays freely editable and a
 * later change of the template only replaces it on purpose.
 */
export function AgentInstructionsSection({
  value,
  onChange,
  isDisabled,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly isDisabled: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const [template, setTemplate] = useState("");
  function applyTemplate(next: string): void {
    setTemplate(next);
    const match = AGENT_INSTRUCTION_TEMPLATES.find((entry) => entry === next);
    if (!match) return;
    const key: AgentInstructionTemplate = match;
    onChange(t(`agentEmployees.templates.${key}.content`));
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium" htmlFor={id}>
          {t("agentEmployees.documents.template")}
        </label>
        <Select
          id={id}
          ariaLabel={t("agentEmployees.documents.template")}
          className="w-full"
          value={template}
          disabled={isDisabled}
          placeholder={t("agentEmployees.documents.chooseTemplate")}
          onValueChange={applyTemplate}
          options={AGENT_INSTRUCTION_TEMPLATES.map((entry) => ({
            value: entry,
            label: t(`agentEmployees.templates.${entry}.label`),
          }))}
        />
      </div>
      <DocumentField
        title="AGENT.md"
        description={t("agentEmployees.documents.instructionsDescription")}
        value={value}
        maximum={AGENT_DOCUMENT_LIMITS.instructionsCharacters}
        onChange={onChange}
        isDisabled={isDisabled}
      />
    </div>
  );
}
