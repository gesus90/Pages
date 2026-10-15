import { useTranslation } from "react-i18next";

import { BlockEditor } from "@/app/components/editor/block-editor";
import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";
import { isWikiAttachmentPath } from "@/app/lib/wiki-upload";

import { AgentParameterFields } from "./agent-parameter-fields";
import { AgentRunOptionsFields } from "./agent-run-options-fields";

import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { AgentProviderId } from "@/definition/AgentConnection";

/** Uses the existing wiki block editor while preserving markdown placeholders as text. */
export function AgentTemplateEditor(props: {
  readonly workspaceChoices?: readonly AgentWorkspaceChoice[];
  readonly configuration: AgentConfiguration;
  /** The provider of the chosen model; `null` while none is chosen. */
  readonly provider: AgentProviderId | null;
  readonly disabled: boolean;
  readonly onChange: (configuration: AgentConfiguration) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <section className="space-y-4">
      <h3 className="text-base font-semibold">
        {t("settings.agents.definition.markdown")}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t("settings.agents.definition.parameterHint")}
      </p>
      <div className="min-h-80 rounded-xl bg-muted/40 p-4">
        <BlockEditor
          markdown={props.configuration.markdown}
          label={t("settings.agents.definition.markdown")}
          isEditable={!props.disabled}
          hasToolbar
          features={{ isDisplayableImage: isWikiAttachmentPath }}
          fallback={<WikiMarkdown source={props.configuration.markdown} />}
          onChange={(markdown) =>
            props.onChange({ ...props.configuration, markdown })
          }
        />
      </div>
      <AgentParameterFields {...props} />
      <AgentRunOptionsFields
        configuration={props.configuration}
        provider={props.provider}
        disabled={props.disabled}
        onChange={props.onChange}
      />
    </section>
  );
}
