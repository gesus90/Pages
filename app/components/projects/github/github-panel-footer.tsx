import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";

interface GitHubPanelFooterProps {
  readonly isTesting: boolean;
  readonly isSaving: boolean;
  readonly canSave: boolean;
  readonly onTestSubmit: () => void;
}

/** The connection test and save buttons of the GitHub panel. */
export function GitHubPanelFooter({
  isTesting,
  isSaving,
  canSave,
  onTestSubmit,
}: GitHubPanelFooterProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <Form method="post" onSubmit={onTestSubmit}>
        <input name="intent" type="hidden" value="test-integration" />
        <Button
          className="gap-2"
          disabled={isTesting}
          type="submit"
          variant="outline"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          {isTesting
            ? t("projectDetail.integrations.testing")
            : t("projectDetail.integrations.test")}
        </Button>
      </Form>
      <Button
        disabled={!canSave || isSaving}
        form="github-integration-form"
        type="submit"
      >
        {isSaving
          ? t("projectDetail.integrations.saving")
          : t("projectDetail.integrations.save")}
      </Button>
    </>
  );
}
