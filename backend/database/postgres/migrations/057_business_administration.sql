INSERT INTO roles (id, name, hierarchy_rank, department_bound)
VALUES ('role-administration', 'Verwaltung', 1000000, 0);

INSERT INTO role_permissions (role_id, permission, position)
VALUES
    ('role-administration', 'write', 0),
    ('role-administration', 'manage_projects', 1),
    ('role-administration', 'milestones', 2),
    ('role-administration', 'manage_users', 3);

CREATE TABLE management_metadata (
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (target_type, target_id)
);

CREATE TABLE management_audit (
    id BIGSERIAL PRIMARY KEY,
    actor_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    change JSONB NOT NULL
);

CREATE FUNCTION management_audit_projection(document JSONB)
RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
    SELECT COALESCE(jsonb_object_agg(key, CASE
        WHEN length(value::TEXT) > 2048 THEN jsonb_build_object('contentMd5', md5(value::TEXT), 'characters', length(value::TEXT))
        ELSE value
    END), '{}'::JSONB)
    FROM jsonb_each(document)
    WHERE key !~* '(password|token|secret|credential|invitation|data|bytes|payload)';
$$;

CREATE FUNCTION management_audit_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    actor TEXT := current_setting('pages.management_actor', TRUE);
    previous JSONB := CASE WHEN TG_OP = 'INSERT' THEN '{}'::JSONB ELSE to_jsonb(OLD) END;
    following JSONB := CASE WHEN TG_OP = 'DELETE' THEN '{}'::JSONB ELSE to_jsonb(NEW) END;
BEGIN
    IF actor IS NOT NULL AND actor <> '' AND previous IS DISTINCT FROM following THEN
        INSERT INTO management_audit (actor_id, action, target, change)
        VALUES (
            actor,
            TG_OP,
            TG_TABLE_NAME || ':' || COALESCE(following->>'id', previous->>'id', following->>'user_id', previous->>'user_id', following->>'project_id', previous->>'project_id', ''),
            jsonb_build_object('before', management_audit_projection(previous), 'after', management_audit_projection(following))
        );
    END IF;
    RETURN NULL;
END;
$$;

DO $$
DECLARE
    relation RECORD;
BEGIN
    FOR relation IN
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = current_schema()
            AND table_type = 'BASE TABLE'
            AND table_name ~ '^(users|user_authorization|department_members|user_groups|user_group_members|projects|project_members|project_departments|work_items|work_item_.*|wiki_.*|agent_employees|agent_plans|agent_plan_.*|management_metadata)$'
    LOOP
        EXECUTE format('CREATE TRIGGER management_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION management_audit_change()', relation.table_name);
    END LOOP;
END;
$$;
