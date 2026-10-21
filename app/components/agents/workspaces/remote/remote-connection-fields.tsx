import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";

import { RemoteAllowedRoots } from "./remote-allowed-roots";
import { RemoteDepartmentSelect } from "./remote-department-select";
import { RemoteField } from "./remote-field";
import { REMOTE_FIELD_CLASS } from "./remote-field-style";
import { RemoteSecretFields } from "./remote-secret-fields";

import type { Department } from "@/definition/Authorization";
import type {
  RemoteAuthMethod,
  RemoteStoredSecrets,
} from "@/definition/RemoteConnection";
import type { RemoteConnectionDraft } from "./use-remote-connection-form";

const AUTH_METHODS: readonly RemoteAuthMethod[] = [
  "password",
  "key",
  "key_passphrase",
];

/** Host name or address and SSH port side by side. */
function RemoteEndpointFields(props: {
  readonly draft: RemoteConnectionDraft;
  readonly onChange: (change: Partial<RemoteConnectionDraft>) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const { draft } = props;
  const update = props.onChange;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-3">
      <RemoteField id={`${id}-host`} label={t("remote.dialog.host")}>
        <Input
          id={`${id}-host`}
          required
          maxLength={253}
          autoComplete="off"
          spellCheck={false}
          placeholder="nas.example.org"
          className={REMOTE_FIELD_CLASS}
          value={draft.host}
          onChange={(event) => update({ host: event.target.value })}
        />
      </RemoteField>
      <RemoteField id={`${id}-port`} label={t("remote.dialog.port")}>
        <Input
          id={`${id}-port`}
          required
          type="number"
          min={1}
          max={65535}
          inputMode="numeric"
          className={REMOTE_FIELD_CLASS}
          value={draft.port}
          onChange={(event) => update({ port: event.target.value })}
        />
      </RemoteField>
    </div>
  );
}

/**
 * The fields of the connection dialog in the order of the ticket: name, host
 * and port side by side, user, sign-in method, its secrets, department; the
 * allowed directories follow.
 */
export function RemoteConnectionFields(props: {
  readonly draft: RemoteConnectionDraft;
  readonly departments: readonly Department[];
  /** Which secrets are stored, for an edited connection. */
  readonly storedSecrets: RemoteStoredSecrets | null;
  readonly disabled: boolean;
  readonly onChange: (draft: RemoteConnectionDraft) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const { draft, onChange } = props;
  function update(change: Partial<RemoteConnectionDraft>): void {
    onChange({ ...draft, ...change });
  }
  return (
    <fieldset disabled={props.disabled} className="space-y-4">
      <RemoteField id={`${id}-name`} label={t("remote.dialog.name")}>
        <Input
          id={`${id}-name`}
          required
          maxLength={120}
          autoComplete="off"
          placeholder={t("remote.dialog.namePlaceholder")}
          className={REMOTE_FIELD_CLASS}
          value={draft.name}
          onChange={(event) => update({ name: event.target.value })}
        />
      </RemoteField>
      <RemoteEndpointFields draft={draft} onChange={update} />
      <RemoteField id={`${id}-user`} label={t("remote.dialog.username")}>
        <Input
          id={`${id}-user`}
          required
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          className={REMOTE_FIELD_CLASS}
          value={draft.username}
          onChange={(event) => update({ username: event.target.value })}
        />
      </RemoteField>
      <RemoteField id={`${id}-method`} label={t("remote.dialog.authMethod")}>
        <Select<RemoteAuthMethod>
          id={`${id}-method`}
          size="default"
          className={`w-full ${REMOTE_FIELD_CLASS}`}
          value={draft.authMethod}
          disabled={props.disabled}
          onValueChange={(authMethod) => update({ authMethod })}
          options={AUTH_METHODS.map((method) => ({
            value: method,
            label: t(`remote.authMethod.${method}`),
          }))}
        />
      </RemoteField>
      <RemoteSecretFields
        draft={draft}
        storedSecrets={props.storedSecrets}
        onChange={update}
      />
      <RemoteDepartmentSelect
        id={`${id}-department`}
        value={draft.departmentId}
        departments={props.departments}
        disabled={props.disabled}
        onValueChange={(departmentId) => update({ departmentId })}
      />
      <RemoteAllowedRoots
        roots={draft.allowedRoots}
        username={draft.username}
        onChange={(allowedRoots) => update({ allowedRoots })}
      />
    </fieldset>
  );
}
