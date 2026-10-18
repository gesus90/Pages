-- Who added a chat attachment, and for a file of Pica the run that made it (PAGE-92).
-- Uploads of the person keep 'user'; rows written before this migration read as
-- such uploads, so their history, rights and downloads stay as they were.
-- A file of Pica stays unlinked (message_id NULL) with its run until the answer
-- of that run is stored; only then is it linked and shown.
ALTER TABLE chat_attachments ADD COLUMN origin TEXT DEFAULT 'user';

UPDATE chat_attachments
SET origin = 'user'
WHERE origin IS NULL;

ALTER TABLE chat_attachments ADD COLUMN pica_run_id TEXT;
