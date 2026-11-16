#!/usr/bin/env python3
"""End-to-end verification of the Tokrate-CN portable ZIP.

The packaged app is a GUI build (windows_subsystem = "windows"), so nothing can be
read from stdout/stderr. Every assertion therefore uses process exit codes, the
filesystem, and the location of the WebView2 user data directory.

Checks (each one is reported as pass / fail / skipped):
  1. archive      - ZIP integrity, expected entries, checksum sidecar, extraction
                    into a directory whose path contains spaces and Chinese text
  2. webview      - started from an unrelated working directory, the app writes its
                    WebView2 profile into <app dir>/data/webview
  3. no_c_drive   - no Tokrate directory is created or modified under %LOCALAPPDATA%
                    or %APPDATA%
  4. shutdown     - the process tree terminates on request and data/ survives
  5. relocation   - moving the whole folder and restarting still uses data/webview
  6. single_inst  - a second instance exits by itself
  7. fault_path   - a plain file named "data" makes the app fail without falling back
                    to a C: drive profile (either a non-zero exit or a blocking
                    fatal-error dialog; both mean the app refused to start)

Usage:
  python desktop/scripts/portable-verify.py dist/Tokrate-CN-Portable-win-x64.zip

Standard library only. Windows required (taskkill, creationflags).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

APP_DIR_NAME = "Tokrate-CN-Portable"
EXE_NAME = "Tokrate-CN.exe"
README_NAME = "README-CN.txt"
DATA_DIR_NAME = "data"
WEBVIEW_DIR_NAME = "webview"
EXPECTED_ENTRIES = {
    f"{APP_DIR_NAME}/",
    f"{APP_DIR_NAME}/{DATA_DIR_NAME}/",
    f"{APP_DIR_NAME}/{EXE_NAME}",
    f"{APP_DIR_NAME}/{README_NAME}",
}

CREATE_NO_WINDOW = 0x08000000
LAUNCH_READY_TIMEOUT = 60.0
RELAUNCH_READY_TIMEOUT = 30.0
SECOND_INSTANCE_TIMEOUT = 10.0
FAULT_EXIT_TIMEOUT = 30.0
TERMINATE_TIMEOUT = 15.0
MOVE_TIMEOUT = 25.0

STATUS_PASS = "pass"
STATUS_FAIL = "fail"
STATUS_SKIPPED = "skipped"


class CheckFailed(Exception):
    """A check ran and its assertion did not hold."""


class CheckSkipped(Exception):
    """A check could not run, for example because an earlier check failed."""


def log(message: str) -> None:
    print(f"[portable-verify] {message}", flush=True)


# --------------------------------------------------------------------------- report


class Report:
    def __init__(self) -> None:
        self.checks: list[dict] = []

    def add(self, key: str, status: str, detail: str, **extra: object) -> None:
        record = {"check": key, "status": status, "detail": detail}
        if extra:
            record["data"] = extra
        self.checks.append(record)
        log(f"{status.upper():7} {key}: {detail}")

    def status_of(self, key: str) -> str:
        for record in self.checks:
            if record["check"] == key:
                return record["status"]
        return STATUS_SKIPPED

    def run(self, key: str, func) -> None:
        try:
            status, detail, extra = func()
        except CheckFailed as error:
            self.add(key, STATUS_FAIL, str(error))
        except CheckSkipped as error:
            self.add(key, STATUS_SKIPPED, str(error))
        except Exception as error:  # noqa: BLE001 - a crash is a failed check
            self.add(key, STATUS_FAIL, f"unexpected error: {type(error).__name__}: {error}")
        else:
            self.add(key, status, detail, **extra)

    @property
    def failed(self) -> list[dict]:
        return [record for record in self.checks if record["status"] == STATUS_FAIL]

    @property
    def skipped(self) -> list[dict]:
        return [record for record in self.checks if record["status"] == STATUS_SKIPPED]


# --------------------------------------------------------------------------- helpers


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def directory_listing(path: pathlib.Path, limit: int = 12) -> list[str]:
    try:
        names = sorted(entry.name for entry in path.iterdir())
    except OSError:
        return []
    return names[:limit]


def is_non_empty_dir(path: pathlib.Path) -> bool:
    try:
        return path.is_dir() and any(path.iterdir())
    except OSError:
        return False


def fingerprint(root: pathlib.Path, max_entries: int = 5000) -> tuple:
    """Stable, comparable snapshot of a directory tree (name, size, mtime)."""
    if not root.exists():
        return ("<missing>",)
    items: list[tuple[str, int, int]] = []
    for dirpath, dirnames, filenames in os.walk(root):
        base = pathlib.Path(dirpath)
        if len(base.relative_to(root).parts) >= 4:
            dirnames[:] = []
        for name in filenames:
            candidate = base / name
            try:
                stat = candidate.stat()
            except OSError:
                continue
            items.append(
                (str(candidate.relative_to(root)), stat.st_size, int(stat.st_mtime))
            )
            if len(items) >= max_entries:
                return ("<truncated>",) + tuple(sorted(items))
    return tuple(sorted(items))


def tokrate_profile_snapshot() -> dict[str, tuple]:
    """Snapshot of every Tokrate-looking directory in the per-user profile roots."""
    snapshot: dict[str, tuple] = {}
    for variable in ("LOCALAPPDATA", "APPDATA"):
        root_value = os.environ.get(variable)
        if not root_value:
            continue
        root = pathlib.Path(root_value)
        if not root.is_dir():
            continue
        try:
            entries = list(root.iterdir())
        except OSError:
            continue
        for entry in entries:
            if "tokrate" not in entry.name.lower():
                continue
            try:
                is_dir = entry.is_dir()
            except OSError:
                is_dir = False
            snapshot[f"{variable}:{entry.name}"] = fingerprint(entry) if is_dir else ("<file>",)
    return snapshot


def compare_profiles(baseline: dict[str, tuple], current: dict[str, tuple]) -> list[str]:
    problems: list[str] = []
    for key in sorted(set(current) - set(baseline)):
        problems.append(f"new profile entry {key}")
    for key in sorted(set(baseline) & set(current)):
        if baseline[key] != current[key]:
            problems.append(f"modified profile entry {key}")
    return problems


def fresh_writes_since(root: pathlib.Path, since: float, limit: int = 6) -> list[str]:
    """Files under root whose mtime is at or after `since` (2s clock slack)."""
    hits: list[str] = []
    threshold = since - 2.0
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            candidate = pathlib.Path(dirpath) / name
            try:
                mtime = candidate.stat().st_mtime
            except OSError:
                continue
            if mtime >= threshold:
                hits.append(str(candidate.relative_to(root)))
                if len(hits) >= limit:
                    return hits
    return hits


def child_environment() -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if not key.startswith("TOKRATE_")}
    env.pop("WEBVIEW2_USER_DATA_FOLDER", None)
    return env


def launch(exe: pathlib.Path, cwd: pathlib.Path) -> subprocess.Popen:
    cwd.mkdir(parents=True, exist_ok=True)
    return subprocess.Popen(
        [str(exe)],
        cwd=str(cwd),
        env=child_environment(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=CREATE_NO_WINDOW,
        close_fds=True,
    )


def wait_until(predicate, timeout: float, interval: float = 0.25):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return predicate()


def terminate(process: subprocess.Popen) -> int | None:
    """Kill the process tree; returns its exit code, or None if it is still running."""
    if process.poll() is not None:
        return process.returncode
    subprocess.run(
        ["taskkill", "/PID", str(process.pid), "/T", "/F"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    try:
        return process.wait(timeout=TERMINATE_TIMEOUT)
    except subprocess.TimeoutExpired:
        try:
            process.kill()
            return process.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            return None


def move_with_retry(source: pathlib.Path, destination: pathlib.Path) -> None:
    deadline = time.monotonic() + MOVE_TIMEOUT
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            shutil.move(str(source), str(destination))
            return
        except OSError as error:
            last_error = error
            time.sleep(0.5)
    raise CheckFailed(f"could not move the portable folder: {last_error}")


def visible_window_titles(pid: int) -> list[str]:
    """Titles of visible top-level windows owned by `pid`.

    The GUI build reports a fatal startup error with a modal message box and only
    exits once it is dismissed, which never happens on a headless runner. Seeing that
    window is therefore the machine-readable form of "the app refused to start".
    """
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    titles: list[str] = []
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    # Explicit prototypes: without them ctypes truncates 64-bit handles to int.
    user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    user32.EnumWindows.restype = wintypes.BOOL
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextLengthW.restype = ctypes.c_int
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetWindowTextW.restype = ctypes.c_int

    def collect(hwnd, _lparam):
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid and user32.IsWindowVisible(hwnd):
            length = user32.GetWindowTextLengthW(hwnd)
            if length:
                buffer = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buffer, length + 1)
                titles.append(buffer.value)
        return True

    user32.EnumWindows(callback_type(collect), 0)
    return titles


def webview2_runtime_info() -> dict[str, object]:
    try:
        import winreg  # noqa: PLC0415 - Windows only
    except ImportError:
        return {"detected": False, "detail": "winreg unavailable"}
    keys = (
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"),
    )
    for hive, path in keys:
        try:
            with winreg.OpenKey(hive, path) as key:
                version, _ = winreg.QueryValueEx(key, "pv")
        except OSError:
            continue
        return {"detected": True, "version": str(version)}
    return {"detected": False, "detail": "WebView2 runtime not found in the registry"}


# --------------------------------------------------------------------------- checks


class PortableSuite:
    def __init__(self, zip_path: pathlib.Path, keep: bool) -> None:
        self.zip_path = zip_path
        self.keep = keep
        self.root: pathlib.Path | None = None
        self.app_dir: pathlib.Path | None = None
        self.exe: pathlib.Path | None = None
        self.processes: list[subprocess.Popen] = []
        self.profile_baseline: dict[str, tuple] | None = None
        self.zip_sha256 = ""
        self.webview2 = webview2_runtime_info()
        self.profile_violations: list[str] = []
        self.relaunch_fresh_writes: list[str] = []
        self.relaunch_folder: pathlib.Path | None = None
        self.verified_launch = False

    # -- infrastructure ----------------------------------------------------

    def require_app(self) -> tuple[pathlib.Path, pathlib.Path]:
        if self.exe is None or self.app_dir is None:
            raise CheckSkipped("check 1 (archive) did not produce a usable app folder")
        return self.app_dir, self.exe

    def cleanup_processes(self) -> None:
        for process in self.processes:
            try:
                terminate(process)
            except Exception:  # noqa: BLE001 - cleanup must never mask a result
                pass
        self.processes.clear()

    def start(self, exe: pathlib.Path, cwd: pathlib.Path, label: str) -> subprocess.Popen:
        try:
            process = launch(exe, cwd)
        except OSError as error:
            raise CheckFailed(f"{label}: could not start {exe.name}: {error}") from error
        self.processes.append(process)
        return process

    # -- 1. archive --------------------------------------------------------

    def check_archive(self):
        zip_path = self.zip_path
        if not zip_path.is_file():
            raise CheckFailed(f"archive not found: {zip_path}")

        sidecar = zip_path.with_name(f"{zip_path.name}.sha256")
        if sidecar.is_file():
            expected = sidecar.read_text(encoding="utf-8").strip().split()[0].lower()
            actual = sha256_file(zip_path)
            if expected != actual:
                raise CheckFailed(
                    f"sha256 mismatch: sidecar says {expected}, archive is {actual}"
                )
            self.zip_sha256 = actual
        else:
            self.zip_sha256 = sha256_file(zip_path)

        with zipfile.ZipFile(zip_path) as archive:
            broken = archive.testzip()
            if broken:
                raise CheckFailed(f"corrupt ZIP member: {broken}")
            names = {info.filename for info in archive.infolist()}
            missing = EXPECTED_ENTRIES - names
            if missing:
                raise CheckFailed(f"ZIP is missing expected entries: {sorted(missing)}")
            unexpected = names - EXPECTED_ENTRIES
            if unexpected:
                raise CheckFailed(f"ZIP has unexpected entries: {sorted(unexpected)}")
            data_entry = next(
                info for info in archive.infolist() if info.filename == f"{APP_DIR_NAME}/{DATA_DIR_NAME}/"
            )
            if not data_entry.is_dir():
                raise CheckFailed("data/ is not stored as a directory entry")

            base = pathlib.Path(tempfile.gettempdir()) / "Tokrate CN 便携 验证"
            self.root = base / f"run-{os.getpid()}-{int(time.time())}"
            shutil.rmtree(self.root, ignore_errors=True)
            self.root.mkdir(parents=True, exist_ok=True)
            archive.extractall(self.root)

        app_dir = self.root / APP_DIR_NAME
        exe = app_dir / EXE_NAME
        if not exe.is_file():
            raise CheckFailed(f"extracted executable missing: {exe}")
        if not (app_dir / README_NAME).is_file():
            raise CheckFailed("extracted README-CN.txt missing")
        data_dir = app_dir / DATA_DIR_NAME
        if not data_dir.is_dir():
            raise CheckFailed("extracted data/ is not a directory")
        leftovers = directory_listing(data_dir)
        if leftovers:
            raise CheckFailed(f"data/ should ship empty, found: {leftovers}")

        self.app_dir = app_dir
        self.exe = exe
        log(f"extracted to {self.root}")
        log(f"executable sha256 {sha256_file(exe)}")
        return (
            STATUS_PASS,
            f"extracted to a path with spaces and Chinese text ({self.root})",
            {
                "tempRoot": str(self.root),
                "exeSha256": sha256_file(exe),
                "zipSha256": self.zip_sha256,
                "zipBytes": zip_path.stat().st_size,
            },
        )

    # -- 2. webview redirection -------------------------------------------

    def check_webview_redirect(self):
        app_dir, exe = self.require_app()
        assert self.root is not None
        launcher = self.root / "launcher dir"
        data_dir = app_dir / DATA_DIR_NAME
        webview_dir = data_dir / WEBVIEW_DIR_NAME

        started_at = time.time()
        process = self.start(exe, launcher, "check 2")

        def profile_in_place() -> bool:
            return is_non_empty_dir(webview_dir)

        # Stop waiting as soon as the app dies: a dead process will never create
        # the profile, and the exit code is the only diagnostic available.
        ready = wait_until(
            lambda: profile_in_place() or process.poll() is not None,
            LAUNCH_READY_TIMEOUT,
        )
        if not ready or process.poll() is not None:
            code = process.poll()
            detail = (
                f"data/webview/ never appeared within {LAUNCH_READY_TIMEOUT:.0f}s; "
                f"data/ holds {directory_listing(data_dir)}"
            )
            if code is not None:
                detail += f"; the app exited early with code {code}"
            else:
                windows = visible_window_titles(process.pid)
                if windows:
                    detail += f"; the app is showing: {windows[:3]}"
            raise CheckFailed(detail)

        webview_entries = directory_listing(webview_dir)
        fresh = fresh_writes_since(data_dir, started_at)
        if not fresh:
            raise CheckFailed(
                "data/webview/ exists but nothing under data/ was written after launch; "
                "the profile may not actually be redirected"
            )
        self.verified_launch = True
        return (
            STATUS_PASS,
            f"data/webview/ created and written from an unrelated cwd ({webview_entries[:4]})",
            {
                "cwd": str(launcher),
                "webviewDir": str(webview_dir),
                "webviewEntries": webview_entries,
                "freshWrites": fresh,
                "webview2": self.webview2,
            },
        )

    # -- 3. no writes to the user profile ---------------------------------

    def check_no_profile_writes(self):
        if self.profile_baseline is None:
            raise CheckSkipped("no profile baseline was captured")
        if not self.verified_launch:
            raise CheckSkipped("check 2 (webview) never reached a running app")
        current = tokrate_profile_snapshot()
        problems = compare_profiles(self.profile_baseline, current)
        self.profile_violations = problems
        if problems:
            raise CheckFailed(
                "the portable build wrote outside its folder: " + "; ".join(problems[:6])
            )
        return (
            STATUS_PASS,
            "no Tokrate directory created or modified under %LOCALAPPDATA% / %APPDATA%",
            {"profileRoots": sorted(self.profile_baseline or {}) or ["<none before launch>"]},
        )

    # -- 4. shutdown keeps data/ ------------------------------------------

    def check_shutdown(self):
        app_dir, _exe = self.require_app()
        if not self.processes:
            raise CheckSkipped("no running instance from check 2")
        process = self.processes[0]
        code = terminate(process)
        self.processes.clear()
        if code is None:
            raise CheckFailed("the process tree did not terminate within the timeout")
        data_dir = app_dir / DATA_DIR_NAME
        webview_dir = data_dir / WEBVIEW_DIR_NAME
        if not data_dir.is_dir():
            raise CheckFailed("data/ disappeared after shutdown")
        if not is_non_empty_dir(webview_dir):
            raise CheckFailed("data/webview/ is empty after shutdown")
        return (
            STATUS_PASS,
            f"process tree exited (code {code}) and data/ still holds its WebView2 profile",
            {"exitCode": code, "dataDir": str(data_dir)},
        )

    # -- 5. relocation -----------------------------------------------------

    def check_relocation(self):
        app_dir, _exe = self.require_app()
        assert self.root is not None
        webview_dir = app_dir / DATA_DIR_NAME / WEBVIEW_DIR_NAME
        before = fingerprint(webview_dir)

        destination_parent = self.root / "移动后的位置 with spaces"
        destination_parent.mkdir(parents=True, exist_ok=True)
        destination = destination_parent / f"{APP_DIR_NAME} 移动"
        move_with_retry(app_dir, destination)
        moved_exe = destination / EXE_NAME
        if not moved_exe.is_file():
            raise CheckFailed(f"executable missing after the move: {moved_exe}")
        # Track the new location immediately: later checks must not depend on the
        # old path even if this launch fails.
        self.app_dir = destination
        self.exe = moved_exe
        moved_webview = destination / DATA_DIR_NAME / WEBVIEW_DIR_NAME

        started_at = time.time()
        process = self.start(moved_exe, self.root / "launcher 移动", "check 5")

        def relocated_ready() -> bool:
            return is_non_empty_dir(moved_webview) and bool(
                fresh_writes_since(destination / DATA_DIR_NAME, started_at)
            )

        wait_until(
            lambda: relocated_ready() or process.poll() is not None,
            RELAUNCH_READY_TIMEOUT,
        )
        if process.poll() is not None or not relocated_ready():
            code = process.poll()
            raise CheckFailed(
                "after moving the folder the app did not reuse the moved data/webview "
                f"within {RELAUNCH_READY_TIMEOUT:.0f}s (exit code: {code}, "
                f"data/ holds {directory_listing(destination / DATA_DIR_NAME)})"
            )

        fresh = fresh_writes_since(destination / DATA_DIR_NAME, started_at)
        after = fingerprint(moved_webview)
        if after == before and not fresh:
            raise CheckFailed("the moved data/webview was not touched on the second start")
        self.relaunch_fresh_writes = fresh
        self.relaunch_folder = destination
        return (
            STATUS_PASS,
            f"restarted from {destination} and wrote to the moved data/webview/",
            {
                "movedTo": str(destination),
                "webviewFingerprintChanged": after != before,
                "freshWrites": fresh,
            },
        )

    # -- 6. single instance ------------------------------------------------

    def check_single_instance(self):
        _app_dir, exe = self.require_app()
        assert self.root is not None
        if not self.processes:
            raise CheckSkipped("check 5 did not leave a running instance")
        first = self.processes[0]
        if first.poll() is not None:
            raise CheckSkipped(f"the first instance already exited with code {first.returncode}")

        second = self.start(exe, self.root / "launcher 单实例", "check 6")
        started_at = time.monotonic()
        exited = False
        try:
            second.wait(timeout=SECOND_INSTANCE_TIMEOUT)
            exited = True
        except subprocess.TimeoutExpired:
            terminate(second)
        elapsed = time.monotonic() - started_at
        if not exited:
            raise CheckFailed(
                f"the second instance was still running after {SECOND_INSTANCE_TIMEOUT:.0f}s "
                f"(first instance exit code: {first.poll()})"
            )
        if first.poll() is not None:
            raise CheckFailed(
                f"the first instance died (code {first.returncode}) when the second one started"
            )
        return (
            STATUS_PASS,
            f"second instance exited after {elapsed:.1f}s, the first one kept running",
            {"secondExitCode": second.returncode, "elapsedSeconds": round(elapsed, 1)},
        )

    # -- 7. fault path -----------------------------------------------------

    def check_fault_path(self):
        _app_dir, exe = self.require_app()
        assert self.root is not None
        # Stop every instance started above so their writes cannot be attributed to
        # this launch, then let WebView2 helpers release the profile.
        self.cleanup_processes()
        time.sleep(1.0)

        fault_dir = self.root / "故障路径 copy 空格"
        if not exe.is_file():
            raise CheckSkipped(f"executable no longer available at {exe}")
        shutil.rmtree(fault_dir, ignore_errors=True)
        fault_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(exe, fault_dir / EXE_NAME)
        blocked = fault_dir / DATA_DIR_NAME
        blocked.write_text("this is a file on purpose, not a directory\n", encoding="utf-8")
        blocked_before = blocked.stat()

        before = tokrate_profile_snapshot()
        process = self.start(fault_dir / EXE_NAME, self.root / "launcher 故障", "check 7")
        deadline = time.monotonic() + FAULT_EXIT_TIMEOUT
        dialog_titles: list[str] = []
        while time.monotonic() < deadline:
            if process.poll() is not None:
                break
            dialog_titles = visible_window_titles(process.pid)
            if dialog_titles:
                break
            time.sleep(0.25)

        exited = process.poll() is not None
        code = process.returncode
        if not exited and dialog_titles:
            # A modal fatal-error dialog: the app refused to start, and a headless
            # runner can never click it away. Count that as an explicit failure.
            terminate(process)
        elif not exited:
            terminate(process)
            raise CheckFailed(
                f"with data as a plain file the app neither exited nor showed an error "
                f"dialog within {FAULT_EXIT_TIMEOUT:.0f}s"
            )
        if exited and code == 0:
            raise CheckFailed("the app exited with code 0 when data/ could not be created")

        after = tokrate_profile_snapshot()
        problems = compare_profiles(before, after)
        if problems:
            raise CheckFailed(
                "the failing run fell back to the user profile: " + "; ".join(problems[:6])
            )
        if blocked.is_dir():
            raise CheckFailed("the plain file named data was replaced by a directory")
        blocked_after = blocked.stat()
        if (blocked_after.st_size, int(blocked_after.st_mtime)) != (
            blocked_before.st_size,
            int(blocked_before.st_mtime),
        ):
            raise CheckFailed("the plain file named data was written to during the failed start")
        if not exited:
            return (
                STATUS_PASS,
                "refused to start and blocked on its fatal-error dialog "
                f"({dialog_titles[:1]}), with no %LOCALAPPDATA% / %APPDATA% writes",
                {"exitCode": None, "dialogTitles": dialog_titles[:3], "faultDir": str(fault_dir)},
            )
        return (
            STATUS_PASS,
            f"exited with code {code} and wrote nothing to %LOCALAPPDATA% / %APPDATA%",
            {"exitCode": code, "faultDir": str(fault_dir)},
        )


# --------------------------------------------------------------------------- main


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Verify the Tokrate-CN portable ZIP.")
    parser.add_argument("archive", help="path to Tokrate-CN-Portable-win-x64.zip")
    parser.add_argument(
        "--json-out",
        default=None,
        help="write the JSON summary here (default: next to the archive)",
    )
    parser.add_argument(
        "--keep",
        action="store_true",
        help="keep the temporary extraction folder even on success",
    )
    args = parser.parse_args(argv)

    if os.name != "nt":
        print("[portable-verify] this verification only runs on Windows", file=sys.stderr)
        return 2

    zip_path = pathlib.Path(args.archive).resolve()
    json_out = (
        pathlib.Path(args.json_out).resolve()
        if args.json_out
        else zip_path.with_name("portable-verify.json")
    )

    report = Report()
    suite = PortableSuite(zip_path, args.keep)
    log(f"archive: {zip_path}")
    log(f"webview2: {json.dumps(suite.webview2, ensure_ascii=False)}")

    # The profile baseline must exist before the very first launch.
    suite.profile_baseline = tokrate_profile_snapshot()

    report.run("archive", suite.check_archive)
    report.run("webview", suite.check_webview_redirect)
    report.run("no_c_drive", suite.check_no_profile_writes)
    report.run("shutdown", suite.check_shutdown)
    report.run("relocation", suite.check_relocation)
    report.run("single_instance", suite.check_single_instance)
    report.run("fault_path", suite.check_fault_path)

    suite.cleanup_processes()

    # Final profile comparison covers every launch, including the fault path.
    final_problems = (
        compare_profiles(suite.profile_baseline, tokrate_profile_snapshot())
        if suite.profile_baseline is not None
        else []
    )
    if final_problems and report.status_of("no_c_drive") != STATUS_FAIL:
        report.add(
            "no_c_drive",
            STATUS_FAIL,
            "profile writes appeared after later launches: " + "; ".join(final_problems[:6]),
        )

    summary = {
        "ok": not report.failed,
        "archive": str(zip_path),
        "archiveSha256": suite.zip_sha256,
        "tempRoot": str(suite.root) if suite.root else None,
        "webview2": suite.webview2,
        "checks": report.checks,
        "failures": [record["check"] for record in report.failed],
        "skipped": [record["check"] for record in report.skipped],
    }

    try:
        json_out.parent.mkdir(parents=True, exist_ok=True)
        json_out.write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        log(f"summary written to {json_out}")
    except OSError as error:
        log(f"could not write the summary file: {error}")

    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)

    if report.failed:
        print(
            "便携验证失败：" + "、".join(record["check"] for record in report.failed),
            file=sys.stderr,
            flush=True,
        )
        if suite.root and suite.root.exists():
            print(f"临时目录保留以便排查：{suite.root}", file=sys.stderr, flush=True)
        return 1

    if suite.root and suite.root.exists() and not args.keep:
        shutil.rmtree(suite.root, ignore_errors=True)
    print("便携验证通过：所有检查项均通过或按要求跳过。", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
        sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
    except AttributeError:  # pragma: no cover - very old interpreters
        pass
    sys.exit(main(sys.argv[1:]))
