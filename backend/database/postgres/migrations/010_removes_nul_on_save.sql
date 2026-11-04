-- Whether this database stores a text without U+0000. DuckDB answers with a macro.
CREATE FUNCTION removes_nul_on_save() RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT TRUE;
$$;
