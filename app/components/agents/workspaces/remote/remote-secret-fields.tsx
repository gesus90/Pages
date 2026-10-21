import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";

import { RemoteField } from "./remote-field";
import { REMOTE_FIELD_CLASS } from "./remote-field-style";

import type { RemoteStoredSecrets } from "@/definition/RemoteConnection";
import type { RemoteConnectionDraft } from "./use-remote-connection-form";

/**
 * Only the secrets of the chosen sign-in method.
 *
 * @remarks
 * Stored secrets are never sent back; their fields stay empty and say that
 * leaving them empty keeps the stored value. `new-password` keeps browsers
 * from filling in the Pages password.
 */
export function RemoteSecretFields(props: {
  readonly draft: RemoteConnectionDraft;
  readonly storedSecrets: RemoteStoredSecrets | null;
  readonly onChange: (change: Partial<RemoteConnectionDraft>) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const { draft, storedSecrets } = props;
  const kept = t("remote.dialog.storedSecret");
  if (draft.authMethod === "password")
    return (
      <RemoteField id={`${id}-password`} label={t("remote.dialog.password")}>
        <Input
          id={`${id}-password`}
          type="password"
          autoComplete="new-password"
          maxLength={1024}
          placeholder={storedSecrets?.password ? kept : undefined}
          className={REMOTE_FIELD_CLASS}
          value={draft.password}
          onChange={(event) => props.onChange({ password: event.target.value })}
        />
      </RemoteField>
    );
  return (
    <>
      <RemoteField id={`${id}-key`} label={t("remote.dialog.privateKey")}>
        <Textarea
          id={`${id}-key`}
          rows={4}
          spellCheck={false}
          autoComplete="off"
          maxLength={16384}
          placeholder={
            storedSecrets?.privateKey
              ? kept
              : t("remote.dialog.privateKeyPlaceholder")
          }
          className={`min-h-24 font-mono text-xs ${REMOTE_FIELD_CLASS}`}
          value={draft.privateKey}
          onChange={(event) =>
            props.onChange({ privateKey: event.target.value })
          }
        />
      </RemoteField>
      {draft.authMethod === "key_passphrase" ? (
        <RemoteField
          id={`${id}-passphrase`}
          label={t("remote.dialog.passphrase")}
        >
          <Input
            id={`${id}-passphrase`}
            type="password"
            autoComplete="new-password"
            maxLength={1024}
            placeholder={storedSecrets?.passphrase ? kept : undefined}
            className={REMOTE_FIELD_CLASS}
            value={draft.passphrase}
            onChange={(event) =>
              props.onChange({ passphrase: event.target.value })
            }
          />
        </RemoteField>
      ) : null}
    </>
  );
}
