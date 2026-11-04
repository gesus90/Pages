-- JSON documents are TEXT columns, read with the two functions DuckDB has built in.
--
-- JSON.stringify writes a U+0000 in a text as the escape \u0000, and PostgreSQL
-- stores that document. Its JSON functions then refuse the whole document, even
-- for another key, so one such plan would break every list that reads plans. Both
-- functions therefore read such a document with a marker in place of the escape.
-- Only an escape counts: in \\u0000 the backslash itself is what is escaped.
CREATE FUNCTION json_with_nul_marker(document TEXT, marker TEXT) RETURNS JSON
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
    SELECT (
        CASE
            WHEN position('\u0000' IN document) = 0 THEN document
            ELSE regexp_replace(document, '(?<!\\)((?:\\\\)*)\\u0000', '\1' || marker, 'g')
        END
    )::JSON;
$$;

-- The value at a path such as `$.recovery.state` as text, or NULL when it is missing
-- or JSON null. Object and array values keep their JSON form, with \u0000 in it.
-- A string with a U+0000 comes back with those six characters, because a PostgreSQL
-- text cannot hold it; DuckDB answers with the character. Callers compare such a
-- string with a fixed word or an identifier, which it equals in neither database.
--
-- DuckDB rewrites an object or number in its own form (`1.50` as `1.5`, no spaces)
-- and takes the first of two equal keys, where PostgreSQL keeps the text and takes
-- the last. Neither shows: only JSON.stringify writes these columns.
CREATE FUNCTION json_extract_string(document TEXT, path TEXT) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
    keys TEXT[] := string_to_array(substr(path, 3), '.');
    marker TEXT := '<nul>';
BEGIN
    IF position('\u0000' IN document) = 0 THEN
        RETURN document::JSON #>> keys;
    END IF;
    -- A longer marker when the document holds this text, so nothing else turns back.
    WHILE position(marker IN document) > 0 LOOP
        marker := '<' || marker || '>';
    END LOOP;
    RETURN replace(json_with_nul_marker(document, marker) #>> keys, marker, '\u0000');
END;
$$;

-- Every value below a path and the value at the path itself, in no particular order.
-- A missing path has no rows, and a value is for reading on with json_extract_string.
CREATE FUNCTION json_tree(document TEXT, path TEXT DEFAULT '$') RETURNS TABLE (value TEXT)
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
    WITH RECURSIVE tree (node) AS (
        SELECT json_with_nul_marker(document, '<nul>') #> string_to_array(substr(path, 3), '.')
        UNION ALL
        SELECT children.node
        FROM tree
        CROSS JOIN LATERAL (
            SELECT entries.value AS node
            FROM json_each(CASE WHEN json_typeof(tree.node) = 'object' THEN tree.node ELSE JSON '{}' END) AS entries
            UNION ALL
            SELECT elements.value AS node
            FROM json_array_elements(CASE WHEN json_typeof(tree.node) = 'array' THEN tree.node ELSE JSON '[]' END) AS elements
        ) AS children
    )
    SELECT node::TEXT
    FROM tree
    WHERE node IS NOT NULL;
$$;
