-- A JSON string with a U+0000 must equal nothing, as a PostgreSQL text cannot hold the
-- character. With the six characters of its escape it would equal a text that holds
-- exactly these, which is another value. Callers only compare such a string, so it
-- becomes a text no stored identifier has. Objects and arrays keep their escape.
CREATE OR REPLACE FUNCTION json_extract_string(document TEXT, path TEXT) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
    keys TEXT[] := string_to_array(substr(path, 3), '.');
    marker TEXT := '<nul>';
    readable JSON;
    found TEXT;
BEGIN
    IF position('\u0000' IN document) = 0 THEN
        RETURN document::JSON #>> keys;
    END IF;
    -- A longer marker when the document holds this text, so nothing else turns back.
    WHILE position(marker IN document) > 0 LOOP
        marker := '<' || marker || '>';
    END LOOP;
    readable := json_with_nul_marker(document, marker);
    found := readable #>> keys;
    IF json_typeof(readable #> keys) = 'string' AND position(marker IN found) > 0 THEN
        RETURN 'no-stored-text-' || md5(document);
    END IF;
    RETURN replace(found, marker, '\u0000');
END;
$$;
