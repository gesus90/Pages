-- PAGE-385: the chat shows documents directly and offers every other file
-- for download with its checksum.
--
-- Pages computes the SHA-256 of a file while it streams into the file store,
-- for uploads of people and files of agents alike; files stored before this
-- migration keep NULL and show no checksum. The browser that creates the
-- preview of a PDF also reads its page count and its title from the
-- metadata (PAGE-298 creates previews in the browser, not on the server) and
-- stores them once per attachment; NULL until then.
ALTER TABLE conversation_attachments
    ADD COLUMN sha256 TEXT,
    ADD COLUMN document_pages INTEGER,
    ADD COLUMN document_title TEXT;

ALTER TABLE conversation_attachments
    ADD CONSTRAINT conversation_attachments_sha256_check CHECK (
        sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'
    ),
    ADD CONSTRAINT conversation_attachments_document_pages_check CHECK (
        document_pages IS NULL OR document_pages BETWEEN 1 AND 100000
    ),
    ADD CONSTRAINT conversation_attachments_document_title_check CHECK (
        document_title IS NULL OR char_length(document_title) BETWEEN 1 AND 300
    );
