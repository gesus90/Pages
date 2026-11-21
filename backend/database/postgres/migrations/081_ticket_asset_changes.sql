-- Changes of ticket assets for readers that process their content, such as a
-- text extraction. One row names the attachment, its ticket, the SHA-256 and
-- the MIME type of the bytes and whether the asset was stored or deleted. A
-- row keeps these facts after the attachment row is gone, so a reader learns
-- about a deletion even when the whole ticket or project was deleted.
--
-- The rows come from triggers on work_item_attachments and not from the
-- services: direct uploads, saved descriptions, agent uploads, the offline
-- storage migration and every deletion path write that table, and none of
-- them can forget the change.
CREATE TABLE ticket_asset_changes (
    position BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    attachment_id TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    change TEXT NOT NULL,
    checksum TEXT NOT NULL,
    content_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK (change IN ('stored', 'deleted'))
);

-- The newest change of one asset decides whether its extracted text is current.
CREATE INDEX ticket_asset_changes_attachment
    ON ticket_asset_changes (attachment_id, position);

-- As in the Pages event outbox: the lock is taken before the identity default
-- draws a position and held until the transaction ends, so positions become
-- visible in commit order and a reader that stored the highest position it
-- saw never skips a change committed later.
CREATE FUNCTION lock_ticket_asset_changes() RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(1346455365, 237);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ticket_asset_changes_commit_order
BEFORE INSERT ON ticket_asset_changes
FOR EACH STATEMENT EXECUTE FUNCTION lock_ticket_asset_changes();

CREATE FUNCTION record_ticket_asset_change() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO ticket_asset_changes (
            attachment_id,
            work_item_id,
            change,
            checksum,
            content_type
        )
        VALUES (
            OLD.id,
            OLD.work_item_id,
            'deleted',
            OLD.checksum,
            OLD.content_type
        );

        RETURN OLD;
    END IF;

    INSERT INTO ticket_asset_changes (
        attachment_id,
        work_item_id,
        change,
        checksum,
        content_type
    )
    VALUES (
        NEW.id,
        NEW.work_item_id,
        'stored',
        NEW.checksum,
        NEW.content_type
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER work_item_attachments_record_change
AFTER INSERT OR DELETE ON work_item_attachments
FOR EACH ROW EXECUTE FUNCTION record_ticket_asset_change();

-- Moving only the stored file keeps the bytes; a new type or checksum is a
-- new version for the reader.
CREATE TRIGGER work_item_attachments_record_version
AFTER UPDATE OF checksum, content_type, work_item_id ON work_item_attachments
FOR EACH ROW
WHEN (
    OLD.checksum IS DISTINCT FROM NEW.checksum
    OR OLD.content_type IS DISTINCT FROM NEW.content_type
    OR OLD.work_item_id IS DISTINCT FROM NEW.work_item_id
)
EXECUTE FUNCTION record_ticket_asset_change();

-- Assets that exist before this migration are announced once, oldest first,
-- so a reader starting at position 0 sees every current asset.
INSERT INTO ticket_asset_changes (
    attachment_id,
    work_item_id,
    change,
    checksum,
    content_type
)
SELECT
    id,
    work_item_id,
    'stored',
    checksum,
    content_type
FROM work_item_attachments
ORDER BY
    created_at,
    id;
