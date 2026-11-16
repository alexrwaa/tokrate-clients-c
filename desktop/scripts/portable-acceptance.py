#!/usr/bin/env python3
"""Tokrate-CN 便携版本地验收脚本（Windows x64）。

用法（普通用户权限即可，不修改系统设置）：

    python desktop/scripts/portable-acceptance.py "D:\\Tokrate-CN"
    python desktop/scripts/portable-acceptance.py "D:\\下载\\Tokrate-CN-Portable-win-x64.zip"
    python desktop/scripts/portable-acceptance.py "D:\\Tokrate-CN" --launch
    python desktop/scripts/portable-acceptance.py "D:\\Tokrate-CN" --json report.json

--launch 会启动一次 Tokrate-CN.exe，观察约 25 秒后自动结束进程，用于核对
"不写用户目录 / 不改 Codex 凭证" 这类只有运行时才能观察的项目。默认不启动。

只依赖 Python 标准库与 Windows 自带命令（whoami / reg / tasklist）。只读优先：
写操作仅限在便携目录 data/ 下创建并删除一个探针文件，以及解压 ZIP 到临时目录。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

PASS, FAIL, SKIP = "pass", "fail", "skipped"
STATUS_LABEL = {PASS: "通过", FAIL: "失败", SKIP: "跳过"}

EXE_CANDIDATES = ("Tokrate-CN.exe", "Tokrate.exe", "tokrate-desktop.exe", "tokrate.exe")
CJK_RE = re.compile(r"[\u4e00-\u9fff]")
OFFICIAL_APP_DIR = Path(os.environ.get("LOCALAPPDATA", "")) / "dev.tokrate.desktop"


@dataclass
class Check:
    number: int
    name: str
    status: str = SKIP
    detail: str = ""
    evidence: list[str] = field(default_factory=list)


def human_size(size: int) -> str:
    value = float(size)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} GB"


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_command(args: list[str], timeout: int = 15) -> tuple[int, str]:
    try:
        completed = subprocess.run(
            args,
            capture_output=True,
            timeout=timeout,
            text=True,
            errors="ignore",
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return completed.returncode, (completed.stdout or "") + (completed.stderr or "")
    except (OSError, subprocess.SubprocessError) as error:
        return 1, str(error)


def prepare_root(target: Path) -> tuple[Path, tempfile.TemporaryDirectory | None]:
    """ZIP 解压到临时目录；目录直接使用。返回 (根目录, 临时对象或 None)。"""
    if target.is_dir():
        return target, None
    if not target.exists():
        raise SystemExit(f"路径不存在：{target}")
    if target.suffix.lower() != ".zip":
        raise SystemExit(f"只接受目录或 .zip：{target}")

    temp = tempfile.TemporaryDirectory(prefix="tokrate-acceptance-")
    root = Path(temp.name) / "Tokrate-CN"
    root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target) as archive:
        for member in archive.infolist():
            name = member.filename.replace("\\", "/")
            if name.startswith("/") or ".." in Path(name).parts:
                raise SystemExit(f"ZIP 含不安全路径，拒绝解压：{member.filename}")
        archive.extractall(root)
    # ZIP 可能多包一层目录。
    entries = list(root.iterdir())
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0], temp
    return root, temp


def find_exe(root: Path) -> Path | None:
    for name in EXE_CANDIDATES:
        candidate = root / name
        if candidate.is_file():
            return candidate
    matches = [path for path in root.glob("*.exe") if path.is_file()]
    return matches[0] if len(matches) == 1 else None


def check_01_layout(root: Path, exe: Path | None) -> Check:
    check = Check(1, "解压即用 / 包结构完整")
    if exe is None:
        check.status = FAIL
        check.detail = "根目录找不到 Tokrate-CN.exe（或唯一的 .exe），无法解压即用。"
        check.evidence.append(f"根目录：{root}")
        return check
    files = [path for path in root.rglob("*") if path.is_file()]
    total = sum(path.stat().st_size for path in files)
    check.status = PASS
    check.detail = f"找到可执行文件 {exe.name}，共 {len(files)} 个文件，{human_size(total)}。"
    check.evidence.append(f"{exe}  SHA-256 {sha256_of(exe)}")
    return check


def check_02_path(exe: Path | None) -> Check:
    check = Check(2, "路径兼容（空格 / 中文 / 非系统盘）")
    if exe is None:
        check.status = SKIP
        check.detail = "没有可执行文件，无法判断运行路径。"
        return check
    text = str(exe)
    traits = []
    if " " in text:
        traits.append("含空格")
    if CJK_RE.search(text):
        traits.append("含中文")
    drive = Path(text).drive.upper()
    if drive and drive != os.environ.get("SystemDrive", "C:").upper():
        traits.append(f"非系统盘({drive})")
    check.status = PASS
    check.detail = "当前路径" + ("、" + "、".join(traits) if traits else "不含空格/中文，且位于系统盘") + "；请再用资源管理器把整个文件夹复制到含空格和中文的路径重跑一次。"
    check.evidence.append(text)
    return check


def check_03_data_dir(root: Path, exe: Path | None) -> Check:
    check = Check(3, "data/ 目录自包含且可写")
    if exe is None:
        check.status = FAIL
        check.detail = "没有可执行文件，无法确认数据目录。"
        return check
    data = root / "data"
    created = False
    try:
        if not data.exists():
            data.mkdir(parents=True, exist_ok=True)
            created = True
        probe = data / ".acceptance-probe"
        with probe.open("w", encoding="utf-8") as handle:
            handle.write("tokrate-cn acceptance probe")
        probe.unlink()
    except OSError as error:
        check.status = FAIL
        check.detail = f"data/ 不可写：{error}"
        return check
    owned = [
        name for name in ("settings.json", "history.json", "update-preferences.json", "cache")
        if (data / name).exists()
    ]
    check.status = PASS
    check.detail = (
        f"data/ {'已存在' if not created else '已创建'}且可写"
        + (f"；已有 {', '.join(owned)}" if owned else "；尚未生成设置/历史文件（首次运行后应出现）")
        + "。"
    )
    check.evidence.append(str(data))
    return check


def snapshot_official_dir() -> dict[str, float]:
    snapshot: dict[str, float] = {}
    if not OFFICIAL_APP_DIR.exists():
        return snapshot
    for path in OFFICIAL_APP_DIR.rglob("*"):
        try:
            if path.is_file():
                snapshot[str(path)] = path.stat().st_mtime
        except OSError:
            continue
    return snapshot


def check_04_no_user_dir(root: Path, exe: Path | None, launched: bool, before: dict[str, float]) -> Check:
    check = Check(4, "便携模式不写 %LOCALAPPDATA%")
    if exe is None:
        check.status = SKIP
        check.detail = "没有可执行文件。"
        return check
    if not launched:
        exists = OFFICIAL_APP_DIR.exists()
        check.status = SKIP
        check.detail = (
            "未加 --launch，无法观察运行期写入。"
            + (f" 检测到官方版数据目录 {OFFICIAL_APP_DIR}（可能是官方版，不代表便携版写入）。" if exists else " 当前 %LOCALAPPDATA% 下没有 Tokrate 数据目录。")
        )
        return check
    after = snapshot_official_dir()
    changed = [path for path, mtime in after.items() if before.get(path) != mtime]
    created = [path for path in after if path not in before]
    if changed or created:
        check.status = FAIL
        check.detail = f"运行后 %LOCALAPPDATA% 有 {len(changed)} 个文件被改动、{len(created)} 个新增，便携模式疑似仍写用户目录。"
        check.evidence.extend((changed + created)[:5])
    else:
        check.status = PASS
        check.detail = "运行 25 秒后，%LOCALAPPDATA% 下 Tokrate 数据目录没有新增或改动（若官方版未运行）。"
    return check


def check_05_chinese(exe: Path | None, root: Path) -> Check:
    check = Check(5, "中文本地化 / 语言切换")
    if exe is None:
        check.status = SKIP
        check.detail = "没有可执行文件。"
        return check
    hits = []
    try:
        data = exe.read_bytes()
        for word in ("设置", "语言", "数据源", "监测", "共享"):
            if word.encode("utf-8") in data:
                hits.append(word)
    except OSError as error:
        check.status = SKIP
        check.detail = f"无法读取可执行文件：{error}"
        return check
    locales = [path.name for path in root.rglob("*") if path.is_file() and path.suffix in (".json", ".ftl", ".po") and "locale" in str(path).lower()]
    if hits or locales:
        check.status = PASS
        check.detail = f"可执行文件内命中中文词 {', '.join(hits) or '（无）'}；语言资源 {', '.join(locales) or '无'}。仍需人工确认界面是否全部中文、能否切换。"
    else:
        check.status = FAIL
        check.detail = "可执行文件内未发现常见中文界面词，且没有语言资源文件；汉化很可能未编入本次构建。"
        check.evidence.append("启发式检查：在 exe 中搜索 UTF-8 中文关键词")
    return check


def codex_roots() -> list[Path]:
    env = os.environ.get("CODEX_HOME")
    if env:
        return [Path(env)]
    profile = os.environ.get("USERPROFILE")
    return [Path(profile) / ".codex"] if profile else []


def check_06_codex(exe: Path | None) -> Check:
    check = Check(6, "Codex 会话目录识别")
    roots = codex_roots()
    if not roots:
        check.status = FAIL
        check.detail = "USERPROFILE 与 CODEX_HOME 均不可用，无法定位 Codex 目录。"
        return check
    found = []
    for home in roots:
        sessions = home / "sessions"
        if sessions.is_dir():
            files = list(sessions.rglob("*.jsonl"))
            found.append(f"{sessions}（{len(files)} 个 .jsonl）")
        else:
            found.append(f"{sessions}（不存在）")
    readable = []
    for home in roots:
        sessions = home / "sessions"
        if sessions.is_dir():
            try:
                next(sessions.iterdir(), None)
                readable.append(str(sessions))
            except OSError:
                pass
    check.status = PASS if readable else SKIP
    check.detail = "；".join(found) + (".可读取。" if readable else "。没有可读的会话目录，请先运行一次 Codex 生成日志。")
    check.evidence.extend(found)
    if exe is None:
        check.status = SKIP
        check.detail += " 但未找到 Tokrate-CN.exe，无法验证程序是否自动识别该目录。"
    return check


def check_07_sources(exe: Path | None) -> Check:
    check = Check(7, "数据源检测（多工具）")
    home = Path(os.environ.get("USERPROFILE", ""))
    candidates = {
        "Codex": Path(os.environ.get("CODEX_HOME", home / ".codex")) / "sessions",
        "Claude Code": Path(os.environ.get("CLAUDE_CONFIG_DIR", home / ".claude")) / "projects",
        "Grok Build": Path(os.environ.get("GROK_HOME", home / ".grok")) / "sessions",
        "Antigravity": home / ".gemini",
        "OpenCode": Path(os.environ.get("APPDATA", "")) / "opencode",
        "Kimi Code": Path(os.environ.get("KIMI_CODE_HOME", home / ".kimi-code")),
    }
    present = [name for name, path in candidates.items() if path.exists()]
    absent = [name for name, path in candidates.items() if not path.exists()]
    check.status = PASS if present else SKIP
    check.detail = (
        f"检测到 {len(present)} 个：{', '.join(present) or '无'}"
        + (f"；未检测到：{', '.join(absent)}" if absent else "")
        + "。程序内应能用“选择文件夹/恢复默认”修改，需人工确认。"
    )
    check.evidence.extend(str(path) for path in candidates.values())
    return check


def check_08_monitoring(root: Path) -> Check:
    check = Check(8, "监测开关生效（monitoring）")
    settings = root / "data" / "settings.json"
    if not settings.exists():
        check.status = SKIP
        check.detail = "data/settings.json 尚未生成；请启动程序、关闭“监测”后退出，再重跑本项。"
        return check
    try:
        payload = json.loads(settings.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        check.status = FAIL
        check.detail = f"settings.json 无法解析：{error}"
        return check
    value = payload.get("monitoring")
    check.status = PASS if isinstance(value, bool) else SKIP
    check.detail = f"settings.json 中 monitoring={value!r}；请人工确认关闭后托盘数值停止更新（本脚本不启动界面）。"
    check.evidence.append(str(settings))
    return check


def check_09_coexist(exe: Path | None) -> Check:
    check = Check(9, "与官方版共存（独立数据/单实例）")
    official_exe = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Tokrate" / "Tokrate.exe"
    if exe is None:
        check.status = SKIP
        check.detail = "没有可执行文件。"
        return check
    parts = []
    if OFFICIAL_APP_DIR.exists():
        parts.append(f"官方版数据目录存在：{OFFICIAL_APP_DIR}")
    if official_exe.exists():
        parts.append(f"官方版程序存在：{official_exe}")
    parts.append("便携版数据应只在自身 data/ 下；单实例锁是否与官方版互斥需人工同时启动验证。")
    check.status = SKIP
    check.detail = "；".join(parts)
    return check


def codex_config_snapshot() -> dict[str, tuple[float, int]]:
    snapshot: dict[str, tuple[float, int]] = {}
    for home in codex_roots():
        for name in ("auth.json", "config.toml", "config.json"):
            path = home / name
            try:
                if path.is_file():
                    stat = path.stat()
                    snapshot[str(path)] = (stat.st_mtime, stat.st_size)
            except OSError:
                continue
    return snapshot


def check_10_codex_credentials(before: dict[str, tuple[float, int]], launched: bool, exe: Path | None) -> Check:
    check = Check(10, "不写 Codex 凭证 / 配置")
    if exe is None:
        check.status = SKIP
        check.detail = "没有可执行文件。"
        return check
    after = codex_config_snapshot()
    if not launched:
        check.status = SKIP
        check.detail = (
            f"未加 --launch。已记录 {len(before)} 个 Codex 凭证/配置文件，启动运行后才能对比是否被改写。"
            if before
            else "未加 --launch，且当前没有 auth.json/config.toml 可对比。"
        )
        return check
    changed = [path for path, value in after.items() if before.get(path) != value]
    if changed:
        check.status = FAIL
        check.detail = f"运行后有 {len(changed)} 个 Codex 配置文件被改动：{', '.join(changed)}"
        check.evidence.extend(changed)
    else:
        check.status = PASS
        check.detail = f"运行 25 秒后，{len(after)} 个 Codex 凭证/配置文件的时间与大小均未变化。"
    return check


def check_11_elevation(exe: Path | None) -> Check:
    check = Check(11, "普通用户权限运行（不要求管理员）")
    _, groups = run_command(["whoami", "/groups"])
    elevated = "S-1-16-12288" in groups
    manifest = "未找到"
    if exe is not None:
        try:
            data = exe.read_bytes()
            for level in (b"requireAdministrator", b"highestAvailable", b"asInvoker"):
                if level in data:
                    manifest = level.decode()
                    break
        except OSError:
            pass
    if manifest == "requireAdministrator":
        check.status = FAIL
        check.detail = "可执行文件内嵌清单要求 requireAdministrator。"
    elif elevated:
        check.status = FAIL
        check.detail = "当前终端是高完整性（管理员）进程，无法证明普通用户下可运行；请在普通 PowerShell 中重跑。"
    else:
        check.status = PASS if exe is not None else SKIP
        check.detail = f"当前进程非管理员；清单标记：{manifest}。"
    check.evidence.append(f"elevated={elevated}; manifest={manifest}")
    return check


def check_12_uninstall(root: Path) -> Check:
    check = Check(12, "卸载 = 删除文件夹（无安装残留）")
    leftovers: list[str] = []
    code, output = run_command(["reg", "query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall", "/s", "/f", "Tokrate"])
    # reg query 在“没有匹配”和“被策略/权限拦截”时都可能返回非 0；只有明确读到匹配才算证据。
    registry_checked = code == 0
    if registry_checked and "Tokrate" in output:
        leftovers.append("HKCU 卸载项中存在 Tokrate 注册表项")
    for base in (Path(os.environ.get("APPDATA", "")), Path(os.environ.get("LOCALAPPDATA", ""))):
        for name in ("Tokrate", "Tokrate-CN", "dev.tokrate.desktop"):
            candidate = base / name
            if candidate.exists():
                leftovers.append(str(candidate))
    # 便携目录自身与官方版目录不算“安装残留”，单独说明。
    official = [item for item in leftovers if "dev.tokrate.desktop" in item or item.endswith("Tokrate")]
    suspicious = [item for item in leftovers if item not in official]
    if suspicious:
        check.status = FAIL
        check.detail = "发现可能是便携版写入的安装痕迹：" + "；".join(suspicious)
    elif not registry_checked:
        check.status = SKIP
        check.detail = (
            "无法查询 HKCU 卸载项（reg 返回非 0，可能没有匹配、也可能被策略限制）；"
            "请手动打开注册表编辑器查看 HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall 下是否有 Tokrate"
            + (f"；同时存在官方版目录（共存属正常）：{', '.join(official)}" if official else "")
            + f"。便携版自身数据在 {root / 'data'}，删除整个文件夹即可。"
        )
    else:
        check.status = PASS
        check.detail = (
            "未发现便携版创建的卸载注册表项"
            + (f"；存在官方版目录（共存属正常）：{', '.join(official)}" if official else "")
            + f"。便携版自身数据在 {root / 'data'}，删除整个文件夹即可。"
        )
    check.evidence.extend(leftovers)
    return check


def launch_and_wait(exe: Path, seconds: int = 25) -> tuple[bool, str]:
    try:
        process = subprocess.Popen(
            [str(exe)],
            cwd=str(exe.parent),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except OSError as error:
        return False, str(error)
    time.sleep(seconds)
    alive = process.poll() is None
    if alive:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
    return True, ("仍在运行，已结束" if alive else "启动后自行退出")


def print_human(checks: list[Check], root: Path, exe: Path | None) -> None:
    print("=" * 78)
    print("Tokrate-CN 便携版本地验收")
    print("=" * 78)
    print(f"验收目录：{root}")
    print(f"可执行文件：{exe if exe else '未找到'}")
    print("")
    for check in checks:
        print(f"[{STATUS_LABEL[check.status]:>4}] {check.number:02d}. {check.name}")
        print(f"        {check.detail}")
        for line in check.evidence[:4]:
            print(f"        · {line}")
    counts = {status: sum(1 for check in checks if check.status == status) for status in (PASS, FAIL, SKIP)}
    print("")
    print("-" * 78)
    print(f"通过 {counts[PASS]} · 失败 {counts[FAIL]} · 跳过 {counts[SKIP]}（共 {len(checks)} 项）")
    if counts[FAIL]:
        print("存在失败项：便携版尚未达到验收标准，或本次运行的目录不完整。")
    elif counts[SKIP]:
        print("没有失败项，但有项目需要人工/带 --launch 复核。")
    else:
        print("全部通过。仍建议按 docs/cn-portable/06-local-verification-steps.md 做人工观察。")
    print("")
    print("注意：本脚本只做本机可自动化的检查；Cockpit 同跑、界面观感、托盘行为必须人工验证。")


def main() -> int:
    parser = argparse.ArgumentParser(description="Tokrate-CN 便携版本地验收")
    parser.add_argument("target", help="便携目录或 ZIP 路径")
    parser.add_argument("--launch", action="store_true", help="启动程序约 25 秒以观察运行期写入")
    parser.add_argument("--json", metavar="FILE", help="把结果写入 JSON 文件")
    parser.add_argument("--seconds", type=int, default=25, help="--launch 的观察秒数（默认 25）")
    args = parser.parse_args()

    if os.name != "nt":
        print("此脚本面向 Windows；其他系统上多数检查会跳过。", file=sys.stderr)

    target = Path(args.target).expanduser().resolve()
    root, temp = prepare_root(target)
    try:
        exe = find_exe(root)
        before_official = snapshot_official_dir()
        before_codex = codex_config_snapshot()

        checks = [
            check_01_layout(root, exe),
            check_02_path(exe),
            check_03_data_dir(root, exe),
        ]

        launched = False
        launch_note = ""
        if args.launch and exe is not None:
            launched, launch_note = launch_and_wait(exe, max(5, args.seconds))

        checks.extend(
            [
                check_04_no_user_dir(root, exe, launched, before_official),
                check_05_chinese(exe, root),
                check_06_codex(exe),
                check_07_sources(exe),
                check_08_monitoring(root),
                check_09_coexist(exe),
                check_10_codex_credentials(before_codex, launched, exe),
                check_11_elevation(exe),
                check_12_uninstall(root),
            ]
        )

        if args.launch and exe is not None:
            checks[0].detail += f"（--launch：{launch_note}）"

        print_human(checks, root, exe)
        if args.json:
            payload = {
                "root": str(root),
                "exe": str(exe) if exe else None,
                "launched": launched,
                "checks": [
                    {"number": c.number, "name": c.name, "status": c.status, "detail": c.detail, "evidence": c.evidence}
                    for c in checks
                ],
            }
            Path(args.json).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"JSON 已写入：{args.json}")
        return 0 if all(check.status != FAIL for check in checks) else 1
    finally:
        if temp is not None:
            temp.cleanup()


if __name__ == "__main__":
    sys.exit(main())
