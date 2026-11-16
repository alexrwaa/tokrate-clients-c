//! Portable data layout: every file Tokrate-CN persists lives in `data/` beside the executable.
//!
//! The folder is resolved from `current_exe()`, never from the working directory, so the app
//! behaves the same whether it is started through a shortcut, from another drive, or from a
//! command prompt that happens to sit somewhere else. There is deliberately no fallback to
//! `%LOCALAPPDATA%`: when `data/` cannot be created or written, the app reports the failure and
//! stops instead of quietly persisting to the system drive.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// The folder beside the executable that holds every file the app owns.
pub const DATA_DIR: &str = "data";
/// WebView2's user data folder: cache, cookies and the web storage the UI keeps.
const WEBVIEW_DIR: &str = "webview";
/// Scratch space for anything derived from the logs.
const CACHE_DIR: &str = "cache";
/// Diagnostics the app writes itself.
const LOG_DIR: &str = "logs";
/// Written and removed at startup to prove the folder really accepts writes.
const PROBE_FILE: &str = ".write-probe";
/// WebView2 reads this before it creates its environment. wry passes no data folder of its own,
/// so this is the supported way to keep the browser profile out of `%LOCALAPPDATA%`.
#[cfg(windows)]
const WEBVIEW_PROFILE_ENV: &str = "WEBVIEW2_USER_DATA_FOLDER";

/// The prepared portable folder: every path the app may write lives below it.
#[derive(Clone, Debug)]
pub struct DataRoot {
    root: PathBuf,
}

impl DataRoot {
    /// The `data/` folder itself, where settings, history and checkpoints live.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// WebView2's user data folder, which must exist before the first window is created.
    pub fn webview(&self) -> PathBuf {
        self.root.join(WEBVIEW_DIR)
    }
}

/// `<folder of the running executable>/data`.
pub fn portable_root() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|error| {
        format!(
            "无法确定程序自身所在的位置（{error}），便携数据目录无法初始化。\n\n\
             请把整个 Tokrate-CN-Portable 文件夹解压到普通硬盘目录后再运行，\
             不要直接在压缩包内运行。"
        )
    })?;
    let directory = exe.parent().ok_or_else(|| {
        format!(
            "程序路径 \"{}\" 没有所在目录，便携数据目录无法初始化。",
            exe.display()
        )
    })?;
    Ok(directory.join(DATA_DIR))
}

/// Creates the portable folders below `root` and proves they accept writes.
///
/// Called once at startup, before any window exists: everything the app persists afterwards uses
/// the paths returned here.
pub fn prepare(root: PathBuf) -> Result<DataRoot, String> {
    for folder in [&root, &root.join(CACHE_DIR), &root.join(LOG_DIR), &root.join(WEBVIEW_DIR)] {
        fs::create_dir_all(folder).map_err(|error| create_failed(folder, &error))?;
    }
    // An existing folder can still refuse writes (a read-only drive, a folder another account
    // owns, a full disk), and `create_dir_all` says nothing about that.
    let probe = root.join(CACHE_DIR).join(PROBE_FILE);
    fs::write(&probe, b"tokrate-cn").map_err(|error| create_failed(&probe, &error))?;
    // A leftover probe is harmless; failing to remove it is not worth a startup error.
    let _ = fs::remove_file(&probe);
    Ok(DataRoot { root })
}

fn create_failed(path: &Path, error: &io::Error) -> String {
    format!(
        "无法在便携目录中创建或写入数据：\n{}\n\n原因：{error}\n\n\
         请确认该文件夹可写、磁盘空间充足。若程序被放在只读介质或受保护目录中，\
         请把整个文件夹复制到可写的普通目录后再运行。\n\
         为避免污染系统盘，程序不会自动改用 C 盘的用户目录保存数据。",
        path.display()
    )
}

/// Points WebView2's profile at `dir`, which keeps cache, cookies and localStorage inside the
/// portable folder. Only the WebView2-specific variable is set: `APPDATA`, `LOCALAPPDATA`,
/// `TEMP` and `USERPROFILE` are left untouched for the rest of the process.
pub fn initialize_webview_profile(dir: &Path) {
    #[cfg(windows)]
    {
        std::env::set_var(WEBVIEW_PROFILE_ENV, dir);
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
    }
}

/// Shows a startup failure unless the caller asked for machine-readable output. A Windows GUI
/// build has no console and no window yet, so a native message box is the only way a user can
/// learn why the app will not start; an automation run sets `TOKRATE_NO_DIALOG` instead, because
/// nothing on a headless runner could ever dismiss the box and the process would hang.
pub fn report_fatal(message: &str) {
    eprintln!("{message}");
    if std::env::var_os("TOKRATE_NO_DIALOG").is_some() {
        return;
    }
    let _ = rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title("Tokrate-CN 无法启动")
        .set_description(message)
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("tokrate-portable-{name}-{}", std::process::id()))
    }

    #[test]
    fn the_data_folder_sits_beside_the_running_executable() {
        let root = portable_root().unwrap();
        assert_eq!(root.file_name().unwrap().to_string_lossy(), DATA_DIR);
        assert_eq!(
            root.parent(),
            std::env::current_exe().unwrap().parent(),
            "the portable folder must not depend on the working directory"
        );
    }

    #[test]
    fn preparing_creates_every_folder_the_app_writes_to() {
        let root = scratch("prepare");
        let _ = fs::remove_dir_all(&root);
        let data = prepare(root.clone()).unwrap();
        assert_eq!(data.root(), root.as_path());
        for folder in [&root, &root.join(CACHE_DIR), &root.join(LOG_DIR), &root.join(WEBVIEW_DIR)] {
            assert!(folder.is_dir(), "{} should exist", folder.display());
        }
        assert!(
            !root.join(CACHE_DIR).join(PROBE_FILE).exists(),
            "the write probe must not be left behind"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_file_where_the_data_folder_belongs_is_a_startup_error() {
        let root = scratch("blocked");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.parent().unwrap()).unwrap();
        fs::write(&root, b"not a folder").unwrap();
        let error = prepare(root.clone()).unwrap_err();
        assert!(
            error.contains(&root.display().to_string()),
            "the message must name the folder that could not be used"
        );
        let _ = fs::remove_file(&root);
    }
}
