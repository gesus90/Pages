-- PAGE-270: a sign-in attempt names the access it asks for. 'read' is the
-- first sign-in (drive.file and drive.readonly); 'write' is the targeted,
-- incremental consent for the full drive scope that Storage needs to change
-- files. A declined write consent keeps the stored connection unchanged.
ALTER TABLE google_drive_sign_in_attempt
    ADD COLUMN requested_access TEXT NOT NULL DEFAULT 'read';

ALTER TABLE google_drive_sign_in_attempt
    ADD CONSTRAINT google_drive_sign_in_attempt_requested_access
    CHECK (requested_access IN ('read', 'write'));
