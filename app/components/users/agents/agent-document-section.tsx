import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Textarea } from "@/app/components/ui/textarea";
import { AGENT_DOCUMENT_LIMITS } from "@/definition/AgentEmployee";

import { AgentTemplateList } from "./agent-template-list";

import type { AgentInstructionTemplateList } from "@/definition/AgentInstructionTemplate";

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
 * The tab "Aufgabe": `AGENT.md`, what the agent does (PAGE-266), with the
 * templates of the instance above it (PAGE-283).
 *
 * @remarks
 * A template fills the field once; the text stays freely editable, and a
 * later change of the template changes no agent.
 */
export function AgentInstructionsSection({
  value,
  onChange,
  templates,
  isDisabled,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly templates: AgentInstructionTemplateList;
  readonly isDisabled: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <AgentTemplateList
        templates={templates}
        document={value}
        onApply={onChange}
        isDisabled={isDisabled}
      />
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
