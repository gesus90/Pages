import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { DialogClose } from "@/app/components/ui/dialog";
import { SidePanelContent } from "@/app/components/ui/side-panel";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { isLoginActive } from "@/definition/AgentConnection";

import { AgentAlert } from "./agent-alert";
import { AgentCatalogControls } from "./agent-catalog-controls";
import { AgentChecks } from "./agent-checks";
import { AgentCliLogin } from "./agent-cli-login";
import { AgentFormFields } from "./agent-form-fields";
import { useAgentForm } from "./use-agent-form";
import { useModelAvailability } from "./use-model-availability";

import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";
import type {
  AgentAccessKind,
  AgentConnectionSummary,
} from "@/definition/AgentConnection";
import type { AgentCommandHandler } from "./agent-row-menu";
import type { AgentActions } from "./use-agent-actions";
import type { AgentForm } from "./use-agent-form";
import type { AgentModelAvailability } from "./use-model-availability";

// These codes are already shown at their field; the block alert would repeat them.
const FIELD_ERRORS = new Set<AgentForm["error"]>([
  "name_required",
  "name_too_long",
  "name_taken",
  "api_key_required",
  "api_key_invalid_format",
  "test_model_invalid",
  "test_model_required",
]);

function hasRunningLogin(
  connection: AgentConnectionSummary | undefined,
): boolean {
  return Boolean(
    connection?.cli?.login && isLoginActive(connection.cli.login.state),
  );
}

/** Keeps editable metadata, login and checks in the shared accessible management panel. */
export function AgentConnectionPanel({
  kind,
  catalog,
  connection,
  actions,
  hasPollError,
  onSaved,
  onCommand,
  onReturnFocus,
}: {
  readonly kind: AgentAccessKind;
  readonly catalog?: AgentModelCatalog;
  readonly connection: AgentConnectionSummary | undefined;
  readonly actions: AgentActions;
  readonly hasPollError: boolean;
  readonly onSaved: (id: string) => void;
  readonly onCommand: AgentCommandHandler;
  readonly onReturnFocus: (event: Event) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const form = useAgentForm(kind, connection, onSaved);
  const isLoginRunning = hasRunningLogin(connection);
  const isDisabled =
    form.isDirty || form.isSaving || actions.isPending || isLoginRunning;
  const isCliMissing = connection?.cli?.binaryFound === false;
  const availability = useModelAvailability({
    connection,
    catalog,
    actions,
    isBlocked: isDisabled || isCliMissing,
  });
  return (
    <SidePanelContent
      title={t(
        connection ? "settings.agents.editTitle" : "settings.agents.addTitle",
      )}
      closeLabel={t("settings.agents.close")}
      hasUnsavedChanges={form.isDirty}
      onCloseAutoFocus={onReturnFocus}
    >
      <VerticalScrollArea
        className="min-h-0 flex-1"
        contentClassName="gap-6 px-6 pb-6"
      >
        <PanelForm
          form={form}
          kind={kind}
          catalog={catalog}
          availability={availability}
        />
        <PanelMessages
          error={actions.error}
          hasPollError={hasPollError}
          shouldSaveFirst={form.isDirty || !connection}
        />
        {connection && catalog ? (
          <AgentCatalogControls
            id={connection.id}
            catalog={catalog}
            actions={actions}
            disabled={isDisabled}
            isCli={Boolean(connection.cli)}
          />
        ) : null}
        {connection ? (
          <>
            <AgentCliLogin
              connection={connection}
              disabled={isDisabled}
              actions={actions}
              onCommand={onCommand}
            />
            <AgentChecks
              connection={connection}
              disabled={isDisabled || isCliMissing}
              isChecking={actions.pendingIntent === "run-check"}
              onCommand={onCommand}
            />
          </>
        ) : null}
      </VerticalScrollArea>
      <PanelFooter
        connection={connection}
        isSaving={form.isSaving}
        isBusy={actions.isPending || isLoginRunning}
        onCommand={onCommand}
      />
    </SidePanelContent>
  );
}

function PanelForm({
  form,
  kind,
  catalog,
  availability,
}: {
  readonly form: AgentForm;
  readonly kind: AgentAccessKind;
  readonly catalog: AgentModelCatalog | undefined;
  readonly availability: AgentModelAvailability;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <form id="agent-connection-form" onSubmit={form.handleSubmit}>
      <AgentFormFields
        form={form}
        kind={kind}
        catalog={catalog}
        availability={availability}
      />
      {form.error && !FIELD_ERRORS.has(form.error) ? (
        <div className="mt-3">
          <AgentAlert message={t(`settings.agents.error.${form.error}`)} />
        </div>
      ) : null}
    </form>
  );
}

function PanelFooter({
  connection,
  isSaving,
  isBusy,
  onCommand,
}: {
  readonly connection: AgentConnectionSummary | undefined;
  readonly isSaving: boolean;
  readonly isBusy: boolean;
  readonly onCommand: AgentCommandHandler;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">
      {connection ? (
        <Button
          type="button"
          size="sm"
          variant="destructive-soft"
          className="mr-auto"
          disabled={isSaving || isBusy}
          onClick={() => onCommand(connection, "delete")}
        >
          {t("settings.agents.remove")}
        </Button>
      ) : null}
      <DialogClose asChild>
        <Button type="button" size="sm" variant="ghost" data-panel-dismiss>
          {t("settings.agents.cancel")}
        </Button>
      </DialogClose>
      <Button
        type="submit"
        size="sm"
        form="agent-connection-form"
        isPending={isSaving}
        disabled={isBusy}
      >
        {t("settings.agents.save")}
      </Button>
    </footer>
  );
}

function PanelMessages({
  error,
  hasPollError,
  shouldSaveFirst,
}: {
  readonly error: AgentActions["error"];
  readonly hasPollError: boolean;
  readonly shouldSaveFirst: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      {error ? (
        <AgentAlert
          id="agent-action-error"
          message={t(`settings.agents.error.${error}`)}
        />
      ) : null}
      {hasPollError ? (
        <AgentAlert message={t("settings.agents.pollFailed")} />
      ) : null}
      {shouldSaveFirst ? (
        <p className="text-xs text-muted-foreground">
          {t("settings.agents.saveFirst")}
        </p>
      ) : null}
    </>
  );
}
