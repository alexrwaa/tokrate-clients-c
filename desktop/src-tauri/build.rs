use std::fs;

/// The application commands the bundled UI invokes (`generate_handler!` in `src/main.rs`). Only
/// these are permitted: each needs its own `allow-<command>` permission in
/// `capabilities/default.json`, and a unit test keeps the three lists identical.
const COMMANDS: &[&str] = &[
    "snapshot",
    "update_settings",
    "record_sharing_consent",
    "set_dashboard_filters",
    "retry_sharing",
    "sent_example",
    "update_preferences",
    "set_automatic_update_checks",
    "check_update",
    "check_update_automatically",
    "install_update",
    "restart_after_update",
    "choose_folder",
    "reset_folder",
    "open_history",
    "hide_flyout",
    "open_website",
    "smoke_complete",
    "quit",
];

fn main() {
    // Tokrate-CN Portable keeps no link to the upstream release channel: a new build replaces the
    // executable in place, so an official auto-update must never overwrite the localisation or the
    // portable data layout. These checks fail the build if the feed or the updater plugin is ever
    // configured again.
    let config = fs::read_to_string("tauri.conf.json").expect("Tauri config is required");
    assert!(
        !config.contains("tokrate.dev/updates"),
        "the portable build must not configure the upstream update feed"
    );
    assert!(
        !config.contains("\"updater\""),
        "the portable build must not configure the updater plugin"
    );
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run the Tauri build script");
}
