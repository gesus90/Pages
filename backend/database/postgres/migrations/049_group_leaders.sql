-- PAGE-308: the leadership of a group. A leader is a member of the group that
-- an administrator marks; the mark is a property of the membership, so it
-- disappears with the membership and needs no role of its own. A leader may
-- read the profiles of the agents of the group.
ALTER TABLE user_group_members
    ADD COLUMN is_leader BOOLEAN NOT NULL DEFAULT FALSE;
