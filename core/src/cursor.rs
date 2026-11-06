//! The opaque stream cursor a browser holds as SSE `id`.
//!
//! A cursor is the outbox position up to which a stream was decided, sealed
//! with ChaCha20-Poly1305 under a key derived from `pagesCoreSecret`. Its
//! associated data is the session binding `pages-api` answers for the
//! browser's session, so a cursor only opens for the session it was issued
//! to. Every cursor has a fresh random nonce: two cursors of the same position
//! look unrelated, and a browser learns neither the position nor how many
//! events lie between two of its cursors. The same secret gives the same key
//! after a restart, so cursors stay valid across restarts of the core.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chacha20poly1305::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use sha2::{Digest, Sha256};

/// The format version, the first byte of every cursor.
const CURSOR_FORMAT: u8 = 1;
const NONCE_LENGTH: usize = 12;
const POSITION_LENGTH: usize = 8;
const TAG_LENGTH: usize = 16;
const CURSOR_BYTES: usize = 1 + NONCE_LENGTH + POSITION_LENGTH + TAG_LENGTH;
/// The length of every cursor in base64url without padding.
pub const CURSOR_LENGTH: usize = 50;
/// Separates the key of the cursors from every other use of the secret.
const KEY_CONTEXT: &[u8] = b"pages-core live cursor v1\0";

/// Seals and opens the cursors of the live streams.
pub struct CursorCodec {
    cipher: ChaCha20Poly1305,
}

impl CursorCodec {
    /// Derives the cursor key from the shared secret.
    pub fn new(secret: &str) -> Self {
        let mut digest = Sha256::new();
        digest.update(KEY_CONTEXT);
        digest.update(secret.as_bytes());
        let key = digest.finalize();
        Self {
            cipher: ChaCha20Poly1305::new(Key::from_slice(&key)),
        }
    }

    /// Seals a position for the session of `binding`.
    ///
    /// Returns `None` only if the cipher fails, which it does not for this input size.
    pub fn seal(&self, position: u64, binding: &str) -> Option<String> {
        let nonce = ChaCha20Poly1305::generate_nonce(&mut OsRng);
        let payload = Payload {
            msg: &position.to_be_bytes(),
            aad: binding.as_bytes(),
        };
        let sealed = self.cipher.encrypt(&nonce, payload).ok()?;
        let mut bytes = Vec::with_capacity(CURSOR_BYTES);
        bytes.push(CURSOR_FORMAT);
        bytes.extend_from_slice(&nonce);
        bytes.extend_from_slice(&sealed);
        Some(URL_SAFE_NO_PAD.encode(bytes))
    }

    /// Opens a cursor; `None` when it was altered, issued to another session or is no cursor.
    pub fn open(&self, cursor: &str, binding: &str) -> Option<u64> {
        let bytes = URL_SAFE_NO_PAD.decode(cursor).ok()?;
        if bytes.len() != CURSOR_BYTES || bytes.first() != Some(&CURSOR_FORMAT) {
            return None;
        }
        let (nonce, sealed) = bytes.get(1..)?.split_at(NONCE_LENGTH);
        let payload = Payload {
            msg: sealed,
            aad: binding.as_bytes(),
        };
        let opened = self
            .cipher
            .decrypt(Nonce::from_slice(nonce), payload)
            .ok()?;
        let position: [u8; POSITION_LENGTH] = opened.try_into().ok()?;
        Some(u64::from_be_bytes(position))
    }
}

/// Whether a text has the shape of a cursor; anything else is ignored unread.
pub fn is_cursor_shaped(text: &str) -> bool {
    text.len() == CURSOR_LENGTH
        && text
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}
