import { Plus, Trash2 } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { SearchableSelect } from "@/app/components/ui/searchable-select";
import { Select } from "@/app/components/ui/select";
import { MAXIMUM_REMOTE_ROOTS } from "@/definition/RemoteConnection";

import { RemoteField } from "./remote-field";
import {
  REMOTE_FIELD_CLASS,
  REMOTE_SELECT_TRIGGER_CLASS,
} from "./remote-field-style";
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

function RemoteDepartmentSelect(props: {
  readonly id: string;
  readonly value: string;
  readonly departments: readonly Department[];
  readonly disabled: boolean;
  readonly onValueChange: (departmentId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const options = [...props.departments]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((department) => ({ value: department.id, label: department.name }));
  return (
    <SearchableSelect
      id={props.id}
      label={t("remote.dialog.department")}
      value={props.value}
      options={options}
      disabled={props.disabled}
      className={REMOTE_SELECT_TRIGGER_CLASS}
      onValueChange={props.onValueChange}
      texts={{
        placeholder: t("remote.dialog.departmentPlaceholder"),
        unavailable: t("remote.dialog.departmentUnavailable"),
        search: t("remote.dialog.departmentSearch"),
        empty: t("remote.dialog.departmentEmpty"),
        count: (count, total) =>
          t("remote.dialog.departmentCount", { count, total }),
      }}
    />
  );
}

function RemoteAllowedRoots(props: {
  readonly roots: readonly string[];
  readonly username: string;
  readonly onChange: (roots: readonly string[]) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const { roots, onChange } = props;
  const user = props.username.trim();
  const home = user ? `/home/${user}` : t("remote.dialog.rootsHomeUnknown");
  function update(index: number, root: string): void {
    onChange(
      roots.map((entry, position) => (position === index ? root : entry)),
    );
  }
  function remove(index: number): void {
    onChange(roots.filter((entry, position) => position !== index));
  }
  return (
    <fieldset className="min-w-0 space-y-2" aria-describedby={`${id}-hint`}>
      <legend className="text-sm font-medium">
        {t("remote.dialog.roots")}
      </legend>
      {roots.map((root, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            aria-label={t("remote.dialog.rootsEntry", { number: index + 1 })}
            maxLength={4096}
            spellCheck={false}
            autoComplete="off"
            placeholder="/srv/projects"
            className={`font-mono ${REMOTE_FIELD_CLASS}`}
            value={root}
            onChange={(event) => update(index, event.target.value)}
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("remote.dialog.rootsRemove", { number: index + 1 })}
            onClick={() => remove(index)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {t("remote.dialog.rootsHint", { home })}
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={roots.length >= MAXIMUM_REMOTE_ROOTS}
        onClick={() => onChange([...roots, ""])}
      >
        <Plus className="size-4" aria-hidden="true" />
        {t("remote.dialog.rootsAdd")}
      </Button>
    </fieldset>
  );
}
