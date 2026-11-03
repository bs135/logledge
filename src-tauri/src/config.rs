//! Application-level configuration (selected Vault, known vaults, theme,
//! language, file filter), stored as JSON at
//! `<OS config dir>/logledge/config.json`: the same file the Go build used, so
//! upgrading keeps existing settings.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Deserializer, Serialize};

use crate::error::{Error, Result};

/// Deserializes `null` as the type's default (Go's `json.Unmarshal` accepts
/// `null` for slices and strings).
fn null_default<'de, D, T>(d: D) -> std::result::Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(d)?.unwrap_or_default())
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VaultEntry {
    #[serde(deserialize_with = "null_default")]
    pub path: String,
    #[serde(deserialize_with = "null_default")]
    pub name: String,
    #[serde(
        skip_serializing_if = "String::is_empty",
        deserialize_with = "null_default"
    )]
    pub git_repo_url: String,
    #[serde(
        skip_serializing_if = "String::is_empty",
        deserialize_with = "null_default"
    )]
    pub git_branch: String,
    /// "none" | "pat" | "ssh"
    #[serde(
        skip_serializing_if = "String::is_empty",
        deserialize_with = "null_default"
    )]
    pub git_auth_method: String,
}

/// Settings for filtering the file types displayed in the vault tree.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct FileFilterConfig {
    pub enabled: bool,
    /// "whitelist" | "blacklist"
    #[serde(deserialize_with = "null_default")]
    pub mode: String,
    #[serde(deserialize_with = "null_default")]
    pub whitelist: Vec<String>,
    #[serde(deserialize_with = "null_default")]
    pub blacklist: Vec<String>,
}

impl FileFilterConfig {
    /// The standard file filter configuration.
    pub fn default_filter() -> Self {
        FileFilterConfig {
            enabled: true,
            mode: "whitelist".into(),
            whitelist: vec![".md".into(), ".markdown".into(), ".txt".into()],
            blacklist: vec![
                ".exe".into(),
                ".bin".into(),
                ".dll".into(),
                ".logledge".into(),
            ],
        }
    }
}

/// Application settings persisted across sessions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    /// Absolute path to the Vault root directory selected by the user.
    #[serde(deserialize_with = "null_default")]
    pub vault_path: String,

    /// Known vaults for multi-vault switching.
    #[serde(
        skip_serializing_if = "Vec::is_empty",
        deserialize_with = "null_default"
    )]
    pub vaults: Vec<VaultEntry>,

    /// "dark" | "light" | "system"
    #[serde(
        skip_serializing_if = "String::is_empty",
        deserialize_with = "null_default"
    )]
    pub theme: String,

    /// "vi" | "en"
    #[serde(
        skip_serializing_if = "String::is_empty",
        deserialize_with = "null_default"
    )]
    pub language: String,

    // Legacy global GitHub sync settings, kept as a fallback for vaults
    // configured before per-vault settings existed. The Personal Access Token
    // is never stored here; it lives in the OS keychain.
    #[serde(
        skip_serializing_if = "String::is_empty",
        deserialize_with = "null_default"
    )]
    pub git_repo_url: String,
    #[serde(
        skip_serializing_if = "String::is_empty",
        deserialize_with = "null_default"
    )]
    pub git_branch: String,
    #[serde(
        skip_serializing_if = "String::is_empty",
        deserialize_with = "null_default"
    )]
    pub git_auth_method: String,

    /// File filter preferences for the explorer tree.
    #[serde(deserialize_with = "null_default")]
    pub file_filter: FileFilterConfig,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            vault_path: String::new(),
            vaults: Vec::new(),
            theme: String::new(),
            language: String::new(),
            git_repo_url: String::new(),
            git_branch: String::new(),
            git_auth_method: String::new(),
            file_filter: FileFilterConfig::default_filter(),
        }
    }
}

/// Path to config.json in the OS config directory, creating its folder.
pub fn default_path() -> Result<PathBuf> {
    let dir = dirs::config_dir()
        .ok_or_else(|| Error::msg("cannot determine the user config directory"))?
        .join("logledge");
    fs::create_dir_all(&dir)?;
    Ok(dir.join("config.json"))
}

/// Reads the configuration at `path`. A missing file yields the defaults
/// without error.
pub fn load_from(path: &Path) -> Result<Config> {
    let data = match fs::read(path) {
        Ok(data) => data,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Config::default()),
        Err(e) => return Err(e.into()),
    };
    let mut cfg: Config = serde_json::from_slice(&data)?;
    let filter = &cfg.file_filter;
    if filter.mode.is_empty() && filter.whitelist.is_empty() && filter.blacklist.is_empty() {
        cfg.file_filter = FileFilterConfig::default_filter();
    }
    Ok(cfg)
}

/// Writes the configuration as indented JSON.
pub fn save_to(path: &Path, cfg: &Config) -> Result<()> {
    let data = serde_json::to_vec_pretty(cfg)?;
    fs::write(path, data)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Config {
        Config {
            vault_path: "/path/to/vault-a".into(),
            vaults: vec![
                VaultEntry {
                    path: "/path/to/vault-a".into(),
                    name: "vault-a".into(),
                    git_repo_url: "https://github.com/example/vault-a.git".into(),
                    git_branch: "main".into(),
                    git_auth_method: "pat".into(),
                },
                VaultEntry {
                    path: "/path/to/vault-b".into(),
                    name: "vault-b".into(),
                    git_repo_url: "git@github.com:example/vault-b.git".into(),
                    git_branch: "develop".into(),
                    git_auth_method: "ssh".into(),
                },
            ],
            theme: "dark".into(),
            language: "vi".into(),
            ..Config::default()
        }
    }

    #[test]
    fn json_round_trip() {
        let cfg = sample();
        let parsed: Config = serde_json::from_str(&serde_json::to_string(&cfg).unwrap()).unwrap();
        assert_eq!(parsed, cfg);
    }

    #[test]
    fn default_file_filter() {
        let d = FileFilterConfig::default_filter();
        assert!(d.enabled);
        assert_eq!(d.mode, "whitelist");
        assert_eq!(d.whitelist, [".md", ".markdown", ".txt"]);
        assert_eq!(d.blacklist, [".exe", ".bin", ".dll", ".logledge"]);
    }

    #[test]
    fn reads_config_written_by_go_build() {
        // Shape produced by Go's json.MarshalIndent (omitempty fields absent).
        let go_json = r#"{
  "vaultPath": "C:\\notes",
  "vaults": [
    { "path": "C:\\notes", "name": "notes", "gitRepoUrl": "https://github.com/a/b.git", "gitBranch": "main", "gitAuthMethod": "pat" },
    { "path": "D:\\work", "name": "work" }
  ],
  "theme": "light",
  "fileFilter": { "enabled": false, "mode": "blacklist", "whitelist": null, "blacklist": [".exe"] }
}"#;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        fs::write(&path, go_json).unwrap();

        let cfg = load_from(&path).unwrap();
        assert_eq!(cfg.vault_path, "C:\\notes");
        assert_eq!(cfg.vaults.len(), 2);
        assert_eq!(cfg.vaults[0].git_auth_method, "pat");
        assert_eq!(cfg.vaults[1].git_repo_url, "");
        assert_eq!(cfg.theme, "light");
        assert_eq!(cfg.language, "");
        assert!(!cfg.file_filter.enabled);
        assert_eq!(cfg.file_filter.mode, "blacklist");
        assert!(cfg.file_filter.whitelist.is_empty());
    }

    #[test]
    fn missing_file_and_empty_filter_use_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        assert_eq!(load_from(&path).unwrap(), Config::default());

        fs::write(&path, r#"{"vaultPath":"x","fileFilter":{"enabled":false}}"#).unwrap();
        assert_eq!(
            load_from(&path).unwrap().file_filter,
            FileFilterConfig::default_filter()
        );
    }

    #[test]
    fn save_omits_empty_fields_like_go() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        save_to(
            &path,
            &Config {
                vault_path: "v".into(),
                ..Config::default()
            },
        )
        .unwrap();

        let value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let keys: Vec<_> = value.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["fileFilter", "vaultPath"]);
        assert_eq!(load_from(&path).unwrap().vault_path, "v");
    }
}
