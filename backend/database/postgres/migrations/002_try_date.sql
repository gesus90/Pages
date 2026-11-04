-- The date in a text column, or NULL when it holds none.
--
-- DuckDB answers this with TRY_CAST(date_text AS DATE). PostgreSQL has no TRY_CAST,
-- and its own date input reads other forms (`Jan 1 2026`, `today`), so this
-- function follows what DuckDB accepts: spaces, a year of any length with an
-- optional minus, one separator used twice, a month and a day of one or two
-- digits, an optional ` (BC)`, and then anything except a digit. Callers only
-- compare the result, so a year beyond the range of a PostgreSQL date is infinity.
CREATE FUNCTION try_date(date_text TEXT) RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    special TEXT[] := regexp_match(
        date_text,
        '^[ \t\n\v\f\r]*(-?)(infinity|epoch)[ \t\n\v\f\r]*$',
        'i'
    );
    parts TEXT[] := regexp_match(
        date_text,
        '^[ \t\n\v\f\r]*(-?)([0-9]{1,9})([- /\\])([0-9]{1,2})\3([0-9]{1,2})(?![0-9])(?![ \t\n\v\f\r]\([bB][cC]\)[0-9])([ \t\n\v\f\r]\([bB][cC]\))?'
    );
    year_number INTEGER;
    month_number INTEGER;
    day_number INTEGER;
    last_day INTEGER;
BEGIN
    IF special IS NOT NULL THEN
        IF lower(special[2]) = 'epoch' THEN
            RETURN DATE '1970-01-01';
        END IF;
        RETURN CASE WHEN special[1] = '-' THEN DATE '-infinity' ELSE DATE 'infinity' END;
    END IF;
    IF parts IS NULL THEN
        RETURN NULL;
    END IF;

    year_number := parts[2]::INTEGER;
    month_number := parts[4]::INTEGER;
    day_number := parts[5]::INTEGER;
    IF parts[6] IS NOT NULL THEN
        IF parts[1] = '-' OR year_number = 0 THEN
            RETURN NULL;
        END IF;
        year_number := 1 - year_number;
    ELSIF parts[1] = '-' THEN
        year_number := -year_number;
    END IF;

    last_day := CASE
        WHEN month_number = 2 THEN
            CASE
                WHEN year_number % 4 = 0 AND (year_number % 100 <> 0 OR year_number % 400 = 0) THEN 29
                ELSE 28
            END
        WHEN month_number IN (4, 6, 9, 11) THEN 30
        ELSE 31
    END;
    IF month_number NOT BETWEEN 1 AND 12 OR day_number NOT BETWEEN 1 AND last_day THEN
        RETURN NULL;
    END IF;

    IF (year_number, month_number, day_number) < (-5877641, 6, 25)
        OR (year_number, month_number, day_number) > (5881580, 7, 10) THEN
        RETURN NULL;
    END IF;
    IF year_number < -4712 THEN
        RETURN DATE '-infinity';
    END IF;
    IF year_number > 5874896 THEN
        RETURN DATE 'infinity';
    END IF;
    -- PostgreSQL has no year 0: its year -1 is the year 0 of DuckDB.
    RETURN make_date(CASE WHEN year_number <= 0 THEN year_number - 1 ELSE year_number END, month_number, day_number);
END;
$$;
