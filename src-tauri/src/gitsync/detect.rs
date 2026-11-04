//! Detects the Git remote, branch and matching authentication method of an
//! existing folder, used to pre-fill sync settings when adding a Vault.

use std::fs;
use std::path::Path;
use std::process::Command;

use serde::Serialize;

use super::{prepare_command, AuthMethod};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedGitInfo {
    pub repo_url: String,
    pub branch: String,
    pub auth_method: AuthMethod,
}

/// Runs git in `dir` and returns its trimmed stdout, or `None` on failure.
fn git_output(dir: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(dir);
    prepare_command(&mut cmd);
    let out = cmd.output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Reads `url` from the `[remote "origin"]` section of `.git/config`.
fn origin_url_from_config(dir: &Path) -> Option<String> {
    let text = fs::read_to_string(dir.join(".git").join("config")).ok()?;
    let mut in_origin = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            in_origin = line.eq_ignore_ascii_case(r#"[remote "origin"]"#);
            continue;
        }
        if in_origin && line.starts_with("url") {
            if let Some((_, value)) = line.split_once('=') {
                return Some(value.trim().to_string());
            }
        }
    }
    None
}

/// Detects the origin URL, current branch and auth method of the repository at
/// `dir`. Falls back to parsing `.git/config` and `.git/HEAD` when the git CLI
/// is unavailable or fails.
pub fn detect_git_info(dir: &Path) -> DetectedGitInfo {
    let repo_url = git_output(dir, &["remote", "get-url", "origin"])
        .filter(|s| !s.is_empty())
        .or_else(|| {
            git_output(dir, &["config", "--get", "remote.origin.url"]).filter(|s| !s.is_empty())
        })
        .or_else(|| origin_url_from_config(dir))
        .unwrap_or_default();

    let mut branch = git_output(dir, &["rev-parse", "--abbrev-ref", "HEAD"])
        .filter(|b| !b.is_empty() && b != "HEAD")
        .unwrap_or_else(|| "main".to_string());
    if branch == "main" {
        if let Ok(head) = fs::read_to_string(dir.join(".git").join("HEAD")) {
            if let Some(b) = head.trim().strip_prefix("ref: refs/heads/") {
                if !b.is_empty() {
                    branch = b.to_string();
                }
            }
        }
    }

    let auth_method = AuthMethod::for_url(&repo_url);
    DetectedGitInfo {
        repo_url,
        branch,
        auth_method,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git_dir_with(config: Option<&str>, head: Option<&str>) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let git = dir.path().join(".git");
        fs::create_dir(&git).unwrap();
        if let Some(c) = config {
            fs::write(git.join("config"), c).unwrap();
        }
        if let Some(h) = head {
            fs::write(git.join("HEAD"), h).unwrap();
        }
        dir
    }

    #[test]
    fn non_git_directory() {
        let dir = tempfile::tempdir().unwrap();
        let info = detect_git_info(dir.path());
        assert_eq!(info.repo_url, "");
        assert_eq!(info.branch, "main");
        assert_eq!(info.auth_method, AuthMethod::None);
    }

    #[test]
    fn git_without_remote() {
        let dir = git_dir_with(None, None);
        let info = detect_git_info(dir.path());
        assert_eq!(info.repo_url, "");
        assert_eq!(info.auth_method, AuthMethod::None);
    }

    #[test]
    fn config_parsing() {
        let dir = git_dir_with(
            Some(
                "[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n\
                 [remote \"origin\"]\n\turl = https://github.com/sample/test-repo.git\n\
                 \tfetch = +refs/heads/*:refs/remotes/origin/*\n",
            ),
            Some("ref: refs/heads/develop\n"),
        );
        let info = detect_git_info(dir.path());
        assert_eq!(info.repo_url, "https://github.com/sample/test-repo.git");
        assert_eq!(info.branch, "develop");
        assert_eq!(info.auth_method, AuthMethod::Pat);
    }

    #[test]
    fn ssh_config_parsing() {
        let dir = git_dir_with(
            Some("[remote \"origin\"]\n\turl = git@github.com:sample/ssh-repo.git\n"),
            None,
        );
        let info = detect_git_info(dir.path());
        assert_eq!(info.repo_url, "git@github.com:sample/ssh-repo.git");
        assert_eq!(info.auth_method, AuthMethod::Ssh);
        assert_eq!(
            serde_json::to_value(&info).unwrap(),
            serde_json::json!({
                "repoUrl": "git@github.com:sample/ssh-repo.git",
                "branch": "main",
                "authMethod": "ssh"
            })
        );
    }
}
