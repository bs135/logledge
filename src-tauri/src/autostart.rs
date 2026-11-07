//! Launch at login: registers Logledge with the OS (Windows: the per-user
//! `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` key; macOS: a
//! LaunchAgent; Linux: an XDG autostart entry) so it starts hidden in the tray.
//! The `launchAtStartup` setting in config.json is the source of truth; the OS
//! registration is brought in line with it on every start and on each toggle.

use auto_launch::{AutoLaunch, AutoLaunchBuilder};

use crate::error::{Error, Result};

/// Argument added to the login command. A launch carrying it starts with the
/// main window hidden in the tray.
pub const AUTOSTART_ARG: &str = "--autostart";

/// Name of the Run value / LaunchAgent / desktop entry.
const APP_NAME: &str = "Logledge";

/// Whether this process was started by the OS at login.
pub fn launched_at_login<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().any(|a| a.as_ref() == AUTOSTART_ARG)
}

fn launcher() -> Result<AutoLaunch> {
    let exe = std::env::current_exe()?;
    let exe = exe.to_string_lossy();
    let mut builder = AutoLaunchBuilder::new();
    builder.set_app_name(APP_NAME).set_args(&[AUTOSTART_ARG]);

    #[cfg(windows)]
    {
        // Quoted so a path with spaces (e.g. a user name with a space) runs.
        // Per-user only: the default tries HKLM first when elevated.
        builder
            .set_app_path(&format!("\"{exe}\""))
            .set_windows_enable_mode(auto_launch::WindowsEnableMode::CurrentUser);
    }
    #[cfg(target_os = "macos")]
    {
        // A LaunchAgent needs no Automation permission, unlike AppleScript.
        builder
            .set_app_path(&exe)
            .set_macos_launch_mode(auto_launch::MacOSLaunchMode::LaunchAgent);
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        // Inside an AppImage, current_exe is the temporary mount; register the
        // AppImage file itself.
        let path = std::env::var("APPIMAGE").unwrap_or_else(|_| exe.into_owned());
        builder.set_app_path(&path);
    }

    builder.build().map_err(|e| Error::msg(e.to_string()))
}

fn to_err(e: auto_launch::Error) -> Error {
    Error::msg(format!("launch at startup: {e}"))
}

/// The command currently stored under our HKCU Run value, if any.
#[cfg(windows)]
fn registered_command() -> Option<String> {
    windows_registry::CURRENT_USER
        .open(r"Software\Microsoft\Windows\CurrentVersion\Run")
        .and_then(|key| key.get_string(APP_NAME))
        .ok()
}

/// Registers or unregisters the app to launch at login.
///
/// With `enabled`, the entry is (re)written only when it is missing or points
/// elsewhere (e.g. the app moved), so a "Disabled" set in Task Manager's
/// Startup tab is left alone until the user toggles the setting again.
pub fn apply(enabled: bool) -> Result<()> {
    let launcher = launcher()?;
    if enabled {
        #[cfg(windows)]
        let up_to_date = {
            let expected = format!("{} {}", launcher.get_app_path(), AUTOSTART_ARG);
            registered_command().as_deref() == Some(expected.as_str())
        };
        #[cfg(not(windows))]
        let up_to_date = launcher.is_enabled().map_err(to_err)?;
        if !up_to_date {
            launcher.enable().map_err(to_err)?;
        }
        return Ok(());
    }
    match launcher.disable() {
        Ok(()) => Ok(()),
        // Already absent.
        Err(auto_launch::Error::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(to_err(e)),
    }
}

/// Toggled from Settings: always writes the entry when enabling, so it also
/// clears a "Disabled" set in Task Manager.
pub fn set(enabled: bool) -> Result<()> {
    let launcher = launcher()?;
    if enabled {
        launcher.enable().map_err(to_err)
    } else {
        apply(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_login_launch_flag() {
        assert!(launched_at_login(["logledge.exe", AUTOSTART_ARG]));
        assert!(!launched_at_login(["logledge.exe"]));
        assert!(!launched_at_login(["logledge.exe", "--autostart=1"]));
    }
}
