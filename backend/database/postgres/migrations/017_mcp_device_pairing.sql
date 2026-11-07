-- PAGE-243: pairing of machines for the stand-alone Pages MCP program. A
-- machine asks for a pairing, a person confirms it in the browser, and the
-- machine then holds a long-lived token until the pairing is revoked.
-- The tables are their own: older OAuth, token and pairing tables are neither
-- read nor changed. The user code, the device secret and the token exist only
-- as SHA-256 hashes; times are Unix milliseconds.
CREATE TABLE mcp_device_pairing (
    id TEXT PRIMARY KEY,
    user_code_hash TEXT NOT NULL UNIQUE,
    device_secret_hash TEXT NOT NULL,
    device_name TEXT NOT NULL CHECK (char_length(device_name) BETWEEN 1 AND 100),
    client_version TEXT NOT NULL CHECK (char_length(client_version) BETWEEN 1 AND 40),
    -- The hash of the requesting address; the rate limit needs it, nothing else does.
    address_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'cancelled', 'collected')),
    -- The account that decided; unset while the request is open or cancelled.
    user_id TEXT,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    decided_at BIGINT,
    last_polled_at BIGINT
);

CREATE INDEX mcp_device_pairing_address
    ON mcp_device_pairing (address_hash, created_at);
CREATE INDEX mcp_device_pairing_expiry
    ON mcp_device_pairing (expires_at);

CREATE TABLE mcp_device (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    client_version TEXT NOT NULL CHECK (char_length(client_version) BETWEEN 1 AND 40),
    token_hash TEXT NOT NULL UNIQUE,
    paired_at BIGINT NOT NULL,
    last_used_at BIGINT,
    revoked_at BIGINT
);

CREATE INDEX mcp_device_user
    ON mcp_device (user_id)
    WHERE revoked_at IS NULL;
