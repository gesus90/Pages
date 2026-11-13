import { useTranslation } from "react-i18next";

import { formatStepInput } from "./agent-lessons-display";

import type { AgentRecipeView } from "@/definition/AgentDreaming";

function DetailSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-xs font-semibold text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

/** The parameters of a flow recipe: each name as the steps write it, with its description. */
function ParameterList({
  recipe,
}: {
  readonly recipe: AgentRecipeView;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <DetailSection title={t("agentLessons.details.parameters")}>
      <ul className="flex flex-col gap-1">
        {recipe.parameters.map((parameter) => (
          <li key={parameter.name} className="text-sm text-foreground">
            <span className="font-mono">{parameter.name}</span>
            {parameter.description === "" ? null : (
              <span className="text-muted-foreground">
                {" – "}
                {parameter.description}
              </span>
            )}
          </li>
        ))}
      </ul>
    </DetailSection>
  );
}

/** The steps of a flow recipe: tool, note and input as formatted JSON. */
function StepList({
  recipe,
}: {
  readonly recipe: AgentRecipeView;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <DetailSection title={t("agentLessons.details.steps")}>
      <ol className="flex list-decimal flex-col gap-2 pl-5 marker:text-muted-foreground">
        {recipe.steps.map((step, index) => (
          <li key={`${String(index)}:${step.tool}`} className="text-sm">
            <span className="font-mono font-medium text-foreground">
              {step.tool}
            </span>
            {step.note === "" ? null : (
              <span className="text-muted-foreground">
                {" – "}
                {step.note}
              </span>
            )}
            <pre
              aria-label={t("agentLessons.details.stepInput", {
                number: index + 1,
              })}
              className="mt-1 max-h-48 overflow-auto rounded-lg bg-muted/50 p-2 font-mono text-xs break-words whitespace-pre-wrap text-foreground"
              tabIndex={0}
            >
              {formatStepInput(step.input)}
            </pre>
          </li>
        ))}
      </ol>
    </DetailSection>
  );
}

/**
 * What a recipe consists of: for a flow recipe its parameters and its numbered
 * steps, for a knowledge recipe its guide, and for both the keywords.
 */
export function AgentRecipeDetails({
  recipe,
}: {
  readonly recipe: AgentRecipeView;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted/30 p-3">
      {recipe.kind === "flow" ? (
        <>
          {recipe.parameters.length === 0 ? null : (
            <ParameterList recipe={recipe} />
          )}
          <StepList recipe={recipe} />
        </>
      ) : (
        <DetailSection title={t("agentLessons.details.body")}>
          <p className="text-sm break-words whitespace-pre-wrap text-foreground">
            {recipe.body}
          </p>
        </DetailSection>
      )}
      {recipe.keywords.length === 0 ? null : (
        <DetailSection title={t("agentLessons.details.keywords")}>
          <ul className="flex flex-wrap gap-1.5">
            {recipe.keywords.map((keyword) => (
              <li
                key={keyword}
                className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-muted-foreground"
              >
                {keyword}
              </li>
            ))}
          </ul>
        </DetailSection>
      )}
    </div>
  );
}
