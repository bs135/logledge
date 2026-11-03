//! GitHub Personal Access Token storage in the OS keychain (Windows Credential
//! Manager, macOS Keychain, Linux Secret Service). The token is never written
//! to disk in plaintext.
//!
//! Entries stay compatible with go-keyring, used by the Go build (verified in
//! the Tauri migration Phase 0): on Windows the target name is
//! "<service>:<user>" and the secret is stored as raw UTF-8, which keyring-rs's
//! password API would misread as UTF-16, so the byte-level secret API is used.

use keyring::Entry;

use crate::error::{Error, Result};

/// Only one global PAT per machine is supported (one Vault / one GitHub account
/// covers the common case).
const SERVICE: &str = "logledge";
const USER: &str = "github-pat";

fn entry(service: &str, user: &str) -> keyring::Result<Entry> {
    if cfg!(windows) {
        Entry::new_with_target(&format!("{service}:{user}"), service, user)
    } else {
        Entry::new(service, user)
    }
}

fn keyring_error(e: keyring::Error) -> Error {
    Error::msg(e.to_string())
}

fn set(service: &str, user: &str, pat: &str) -> Result<()> {
    entry(service, user)
        .and_then(|e| e.set_secret(pat.as_bytes()))
        .map_err(keyring_error)
}

fn get(service: &str, user: &str) -> Result<Option<String>> {
    match entry(service, user).and_then(|e| e.get_secret()) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| Error::msg("stored GitHub token is not valid UTF-8")),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(keyring_error(e)),
    }
}

fn clear(service: &str, user: &str) -> Result<()> {
    match entry(service, user).and_then(|e| e.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(keyring_error(e)),
    }
}

/// Stores the Personal Access Token in the OS keychain.
pub fn set_pat(pat: &str) -> Result<()> {
    set(SERVICE, USER, pat)
}

/// Reads the Personal Access Token; `None` when none is stored.
pub fn get_pat() -> Result<Option<String>> {
    get(SERVICE, USER)
}

/// Removes the Personal Access Token (no error if absent).
pub fn clear_pat() -> Result<()> {
    clear(SERVICE, USER)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Uses a dedicated service name so the user's real token is never touched.
    #[test]
    fn round_trip_in_os_keychain() {
        let (service, user) = ("logledge-test", "github-pat");
        let token = "ghp_test-Đồng-bộ-✓";
        clear(service, user).unwrap();
        assert_eq!(get(service, user).unwrap(), None);

        set(service, user, token).unwrap();
        assert_eq!(get(service, user).unwrap().as_deref(), Some(token));

        clear(service, user).unwrap();
        assert_eq!(get(service, user).unwrap(), None);
        clear(service, user).unwrap(); // idempotent
    }
}
