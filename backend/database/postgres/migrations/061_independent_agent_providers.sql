-- New sessions keep the selected provider in leases, journals and console state.
ALTER TABLE acp_resource_leases
    DROP CONSTRAINT acp_resource_leases_provider_check,
    ADD CONSTRAINT acp_resource_leases_provider_check
        CHECK (provider IN ('codex_cli', 'claude_code', 'opencode', 'antigravity', 'openrouter', 'zai'));
ALTER TABLE agent_session_attempts
    DROP CONSTRAINT agent_session_attempts_provider_check,
    ADD CONSTRAINT agent_session_attempts_provider_check
        CHECK (provider IN ('codex_cli', 'claude_code', 'opencode', 'antigravity', 'openrouter', 'zai'));
ALTER TABLE agent_plan_terminals
    DROP CONSTRAINT agent_plan_terminals_provider_check,
    ADD CONSTRAINT agent_plan_terminals_provider_check
        CHECK (provider IN ('codex_cli', 'claude_code', 'opencode', 'openrouter', 'zai'));

-- PAGE-411: Only editable settings move. Run snapshots and historical journals
-- retain their original connection, model and reasoning facts.
CREATE TEMPORARY TABLE page411_routes ON COMMIT DROP AS
SELECT
    source.id AS source_id,
    target.id AS target_id,
    target.provider,
    target.provider || '/' AS prefix
FROM agent_connections AS source
CROSS JOIN (
    SELECT DISTINCT ON (connection.provider)
        connection.id,
        connection.provider
    FROM agent_connections AS connection
    INNER JOIN agent_connection_checks AS auth
        ON auth.connection_id = connection.id
        AND auth.kind = 'auth'
        AND auth.status = 'passed'
    WHERE connection.provider IN ('openrouter', 'zai')
        AND connection.is_active = TRUE
        AND connection.secret_encrypted IS NOT NULL
    ORDER BY
        connection.provider,
        LOWER(connection.name),
        connection.id
) AS target
WHERE source.provider = 'opencode';

-- Keep provenance available while profiles and their independent copies move.
CREATE TEMPORARY TABLE page411_profiles ON COMMIT DROP AS
SELECT
    profile.id,
    profile.connection_id
FROM agent_execution_profiles AS profile
INNER JOIN agent_connections AS connection
    ON connection.id = profile.connection_id
WHERE connection.provider = 'opencode';

CREATE FUNCTION page411_assignment(input JSONB) RETURNS JSONB AS $$
DECLARE
    route RECORD;
    selected_model TEXT;
BEGIN
    IF input ? 'runnerRoute' THEN
        RETURN input;
    END IF;
    SELECT
        candidate.target_id,
        candidate.provider,
        candidate.prefix
    INTO route
    FROM page411_routes AS candidate
    WHERE (
        candidate.source_id = input ->> 'connectionId'
        OR (
            NOT (input ? 'connectionId')
            AND EXISTS (
                SELECT 1
                FROM page411_profiles AS profile
                WHERE profile.id = input ->> 'modelProfileId'
                    AND profile.connection_id = candidate.source_id
            )
        )
    )
        AND LEFT(input ->> 'model', LENGTH(candidate.prefix)) = candidate.prefix
        AND LENGTH(input ->> 'model') > LENGTH(candidate.prefix)
    LIMIT 1;
    IF NOT FOUND THEN
        RETURN input;
    END IF;
    selected_model := SUBSTRING(input ->> 'model' FROM LENGTH(route.prefix) + 1);
    RETURN input || jsonb_build_object(
        'connectionId', route.target_id,
        'provider', route.provider,
        'model', selected_model
    );
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION page411_settings(input JSONB) RETURNS JSONB AS $$
DECLARE
    rewritten JSONB;
BEGIN
    IF jsonb_typeof(input) = 'array' THEN
        SELECT COALESCE(jsonb_agg(page411_settings(element) ORDER BY position), '[]'::JSONB)
        INTO rewritten
        FROM jsonb_array_elements(input) WITH ORDINALITY AS entries(element, position);
        RETURN rewritten;
    END IF;
    IF jsonb_typeof(input) <> 'object' THEN
        RETURN input;
    END IF;
    SELECT COALESCE(jsonb_object_agg(key, page411_settings(value)), '{}'::JSONB)
    INTO rewritten
    FROM jsonb_each(input);
    RETURN page411_assignment(rewritten);
END;
$$ LANGUAGE plpgsql;

UPDATE agent_execution_profiles AS profile
SET
    connection_id = route.target_id,
    model = SUBSTRING(profile.model FROM LENGTH(route.prefix) + 1),
    revision = profile.revision + 1
FROM page411_routes AS route
WHERE profile.connection_id = route.source_id
    AND LEFT(profile.model, LENGTH(route.prefix)) = route.prefix
    AND LENGTH(profile.model) > LENGTH(route.prefix);

UPDATE agent_plans
SET
    plan_json = page411_settings(plan_json::JSONB)::TEXT,
    revision = revision + 1
WHERE page411_settings(plan_json::JSONB) <> plan_json::JSONB;

UPDATE agent_plan_templates
SET node_json = page411_settings(node_json::JSONB)::TEXT
WHERE page411_settings(node_json::JSONB) <> node_json::JSONB;

DROP FUNCTION page411_settings(JSONB);
DROP FUNCTION page411_assignment(JSONB);
