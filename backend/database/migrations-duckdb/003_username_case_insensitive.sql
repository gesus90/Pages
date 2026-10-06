-- Usernames are unique regardless of case: "Igor" and "igor" are one name.
-- The plain UNIQUE constraint of `username` keeps its case-sensitive check;
-- this index adds the case-insensitive one. The name keeps the case it was
-- entered with, only comparisons ignore it.
--
-- The migration fails when two existing users already differ only by case;
-- rename one of them first.

CREATE UNIQUE INDEX users_username_lower ON users (lower(username));
