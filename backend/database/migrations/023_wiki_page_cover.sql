-- Optional cover of a wiki page (A8.1): either a prepared gradient
-- ('preset:<name>') or an image attached to the same page
-- ('attachment:<id>'). Existing pages keep no cover.
ALTER TABLE wiki_pages ADD COLUMN cover TEXT;
