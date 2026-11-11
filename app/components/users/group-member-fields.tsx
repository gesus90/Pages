import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Checkbox } from "@/app/components/ui/checkbox";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";

import type { ManagedUser } from "@/definition/Authorization";
import type { ManagedGroup } from "@/definition/UserGroup";

interface GroupMemberFieldsProps {
  readonly selected: ManagedGroup | null;
  /** People the actor may put into a group. */
  readonly candidates: readonly ManagedUser[];
  /** Whether the actor marks leaders: administrators only (PAGE-308). */
  readonly canSetLeaders: boolean;
}

/** Adds or removes one entry of a selection without changing the old one. */
function toggled(
  current: ReadonlySet<string>,
  id: string,
  isSelected: boolean,
): Set<string> {
  const next = new Set(current);
  if (isSelected) next.add(id);
  else next.delete(id);
  return next;
}

/**
 * The members of a group and, for an administrator, their leadership.
 *
 * @remarks
 * A leader is a member: marking a leader adds the membership, and removing
 * a member removes the leadership with it.
 */
export function GroupMemberFields({
  selected,
  candidates,
  canSetLeaders,
}: GroupMemberFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  const [members, setMembers] = useState<ReadonlySet<string>>(
    () => new Set(selected?.memberIds),
  );
  const [leaders, setLeaders] = useState<ReadonlySet<string>>(
    () => new Set(selected?.leaderIds),
  );
  function changeMember(id: string, isMember: boolean): void {
    setMembers((current) => toggled(current, id, isMember));
    if (!isMember) setLeaders((current) => toggled(current, id, false));
  }
  function changeLeader(id: string, isLeader: boolean): void {
    setLeaders((current) => toggled(current, id, isLeader));
    if (isLeader) setMembers((current) => toggled(current, id, true));
  }
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">
        {t("users.groups.members")}
      </legend>
      <p className="text-xs text-muted-foreground">
        {t("users.groups.membersHint")}
      </p>
      {canSetLeaders ? (
        <>
          <input name="leadersSent" type="hidden" value="true" />
          <p className="text-xs text-muted-foreground">
            {t("users.groups.leadersHint")}
          </p>
        </>
      ) : null}
      <ScrollViewport
        axis="vertical"
        containerClassName="max-h-56"
        className="flex flex-col gap-3 overflow-y-auto"
      >
        {candidates.map((user) => (
          <div key={user.id} className="flex items-center gap-4 text-sm">
            <label className="flex flex-1 items-center gap-2">
              <Checkbox
                name="member"
                value={user.id}
                checked={members.has(user.id)}
                onChange={(event) =>
                  changeMember(user.id, event.currentTarget.checked)
                }
              />
              <span className="pages-selectable">{user.displayName}</span>
            </label>
            {canSetLeaders ? (
              <label className="flex items-center gap-2 text-muted-foreground">
                <Checkbox
                  name="leader"
                  value={user.id}
                  checked={leaders.has(user.id)}
                  onChange={(event) =>
                    changeLeader(user.id, event.currentTarget.checked)
                  }
                />
                <span>{t("users.groups.leader")}</span>
              </label>
            ) : null}
          </div>
        ))}
      </ScrollViewport>
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("users.groups.noCandidates")}
        </p>
      ) : null}
    </fieldset>
  );
}
