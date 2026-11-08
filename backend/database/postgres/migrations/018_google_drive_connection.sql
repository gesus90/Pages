-- PAGE-170: the Google Drive sign-in of the system settings. The instance holds
-- at most one Drive connection, which an administrator in the admin mode signs
-- in; nothing grants it to other accounts. The refresh token exists only
-- encrypted with the instance key and bound to its row; access tokens are kept
-- in process memory only. Sign-in attempts store the SHA-256 hash of their
-- OAuth state and the encrypted PKCE verifier. Times are Unix milliseconds.
CREATE TABLE google_drive_sign_in_attempt (
    id TEXT PRIMARY KEY,
    state_hash TEXT NOT NULL UNIQUE,
    -- The administrator who started the sign-in; only that account may finish it.
    user_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_verifier_secret TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    consumed_at BIGINT
);

CREATE INDEX google_drive_sign_in_attempt_expiry
    ON google_drive_sign_in_attempt (expires_at);

CREATE TABLE google_drive_connection (
    -- Always 'instance': one connection per Pages instance.
    id TEXT PRIMARY KEY CHECK (id = 'instance'),
    -- The Drive identifier of the bound Google account; renewals must name the same one.
    google_permission_id TEXT NOT NULL,
    google_email TEXT,
    refresh_token_secret TEXT NOT NULL,
    granted_scope TEXT NOT NULL,
    connected_by_user_id TEXT NOT NULL,
    connected_at BIGINT NOT NULL,
    -- Set when Google refused the stored access; cleared by a new sign-in.
    reauthorization_reason TEXT CHECK (
        reauthorization_reason IN ('access_revoked', 'scope_missing', 'account_changed', 'secret_unavailable')
    ),
    last_refreshed_at BIGINT,
    last_verified_at BIGINT
);
