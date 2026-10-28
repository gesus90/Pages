import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";

/** Shows an available script stream and distinguishes empty text from missing evidence. */
export function PlanScriptStream({
  name,
  text,
}: {
  readonly name: string;
  readonly text: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  let content = text;
  if (content === null) content = t("plans.scripts.run.missing");
  else if (content === "") content = t("plans.scripts.run.empty");
  return (
    <div className="space-y-1">
      <h5 className="font-medium">{name}</h5>
      <ScrollViewport
        as="pre"
        axis="both"
        tabIndex={0}
        aria-label={name}
        containerClassName="max-h-64"
        className="overflow-auto rounded-md border border-border bg-muted p-2 font-mono text-xs whitespace-pre-wrap wrap-anywhere"
      >
        {content}
      </ScrollViewport>
    </div>
  );
}
