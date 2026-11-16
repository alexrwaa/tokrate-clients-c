# 06 · 用户本机最终验收步骤

本清单用于在**你自己的 Windows 电脑**上验收 Tokrate-CN 便携版。自动化部分由脚本完成，
但 Cockpit 同跑、托盘交互、资源占用这些必须在真机上人工观察。

预计耗时：基础项 15 分钟 + Cockpit 同跑 15 分钟。

---

## 0. 准备

| 项目 | 要求 |
| --- | --- |
| 系统 | Windows 10/11 x64 |
| WebView2 | 已安装（Windows 11 自带；10 一般随 Edge） |
| 解压位置 | **非系统盘**、路径可含空格与中文，例如 `D:\工具\Tokrate-CN` |
| 权限 | 普通用户，**不要**用“以管理员身份运行” |
| 其他 | Cockpit 与 Codex 能正常登录使用；准备一个秒表/手机计时 |

先用 `certutil` 核对下载的 ZIP：

```powershell
certutil -hashfile .\Tokrate-CN-Portable-win-x64.zip SHA256
# 与发布页的 .sha256 文件内容逐字比对
```

解压后目录应包含：`Tokrate-CN.exe`、`README-CN.txt`、`data\`。

---

## 1. 自动化检查（先跑脚本）

```powershell
# 只做静态检查
python .\desktop\scripts\portable-acceptance.py "D:\工具\Tokrate-CN"

# 启动 25 秒，观察是否写用户目录 / 改 Codex 配置
python .\desktop\scripts\portable-acceptance.py "D:\工具\Tokrate-CN" --launch

# 保存结果，便于反馈
python .\desktop\scripts\portable-acceptance.py "D:\工具\Tokrate-CN" --launch --json .\acceptance.json
```

判定：

- 输出里 **失败** 项必须为 0；**跳过** 项按下面的人工步骤补齐；
- 第 1、3、10、11 项应是“通过”；第 12 项若提示“无法查询”属正常（脚本不会误报通过），请按第 6 节手动看注册表；
- 第 5 项只检查 exe 内是否编入中文串，**不能**代表汉化覆盖率；覆盖率请跑
  `node desktop/scripts/i18n-coverage-audit.mjs`（当前仍有残留，见 02 文档）。

---

## 2. 基础可用性（人工，5 分钟）

| # | 操作 | 通过标准 | 记录 |
| --- | --- | --- | --- |
| 2.1 | 双击 `Tokrate-CN.exe` | 托盘出现图标；无 UAC 弹窗 | □ |
| 2.2 | 左键点托盘 | 仪表盘在 1 秒内出现，位置贴近托盘 | □ |
| 2.3 | 右键托盘 | 菜单为中文：打开仪表盘/完整历史记录/打开官方网站/退出 | □ |
| 2.4 | 设置 → 数据源 | Codex 显示“已找到”，路径为 `...\.codex\sessions` | □ |
| 2.5 | 用 Codex 完成一次回答 | 仪表盘出现 tok/s 数值；切换模型后数值跟随 | □ |
| 2.6 | 关闭“监测编程工具会话” | 托盘提示“监测已暂停”，数值停止变化 | □ |
| 2.7 | 重新打开监测 | 数值恢复 | □ |

> 2.3–2.7 的界面文案若仍为英文，记录到“汉化未完成”清单（对应 02 文档）。

---

## 3. 数据路径与“不写 C 盘”验证（人工，5 分钟）

1. 完全退出 Tokrate-CN。
2. 记录基线：

```powershell
$before = Get-ChildItem "$env:LOCALAPPDATA\dev.tokrate.desktop" -Recurse -ErrorAction SilentlyContinue |
          Select-Object FullName, LastWriteTime
```

3. 启动程序，正常使用 2 分钟，退出。
4. 再取一次快照并与 `$before` 比较：**不应有新增或修改**。
5. 检查便携目录：

```powershell
Get-ChildItem "D:\工具\Tokrate-CN\data" -Force
# 预期：settings.json、history.json、webview\、cache\、logs\
```

6. 把整个文件夹改名/移动（例如 `D:\工具\Tokrate-CN-2`），重新启动：
   - 能正常启动；
   - 设置与历史仍在（说明数据跟着文件夹走，不依赖注册表/绝对路径）。

**失败判据**：`%LOCALAPPDATA%` 下出现新的 Tokrate 文件，或移动文件夹后设置丢失。

---

## 4. Codex 日志“只读、不占用”验证（人工 + Process Explorer，5 分钟）

### 4.1 文件内容不变

```powershell
$session = Get-ChildItem "$env:USERPROFILE\.codex\sessions" -Recurse -Filter *.jsonl |
           Sort-Object LastWriteTime -Descending | Select-Object -First 1
Get-FileHash $session.FullName; (Get-Item $session.FullName).LastWriteTime
```

启动 Tokrate-CN，等一次采集完成，再算一次：**哈希与修改时间应只由 Codex 自己改变**。
若 Codex 未在写，Tokrate 运行前后哈希必须一致。

### 4.2 是否被占用（关键）

1. 退出 Codex（确保没有回答在生成）。
2. 保持 Tokrate-CN 运行。
3. 在资源管理器里把最近的一个 `.jsonl` **重命名**（例如加 `.bak`）：
   - 能重命名 → 没有独占锁；
   - 提示“文件正在使用” → 记录为问题，继续用 4.3 查是谁占用。
4. 再把文件改回原名。

### 4.3 Process Explorer 查句柄

1. 从微软 Sysinternals 下载 Process Explorer，**以管理员身份**运行（仅用于观察）。
2. `Ctrl+F` → 输入会话文件名（如 `rollout-2026-...jsonl`）→ Search。
3. 看结果列表：
   - 若出现 `Tokrate-CN.exe`，展开看 `Type = File`、`Handle`、`Access`；
   - 记录 `Access` 是否包含 `Write`、`Delete`（只读共享应不含写权限）。
4. **不要**点“Close Handle”，只记录。

### 4.4 结论填写

| 观察项 | 结果 |
| --- | --- |
| Tokrate 运行前后日志哈希一致 | □ 是 □ 否 |
| Codex 空闲时能重命名日志 | □ 是 □ 否 |
| Process Explorer 中 Tokrate 句柄权限 | 记录：__________ |

---

## 5. Cockpit 同跑观察（人工，10 分钟，核心项）

目标：确认 Tokrate-CN 在后台读取日志时，不会让 Cockpit 切换账号卡顿，也不明显占用 CPU/磁盘。

### 5.1 场景 A：不启动 Tokrate（对照组）

1. 启动 Cockpit 并登录账号 A，启动 Codex 并让它完成 1–2 次回答，保持 Cockpit 在前台。
2. 用秒表测 **Cockpit 从账号 A 切到账号 B、再切回 A** 的时间，重复 3 次，记录平均值 `T0`。
3. 观察切换时窗口是否白屏/无响应。

### 5.2 场景 B：Tokrate-CN 同跑（实验组）

1. 保持同样的 Cockpit/Codex 状态，启动 Tokrate-CN（正常监测，不要开共享）。
2. 让 Codex 处于**正在生成回答**的状态（这是 Tokrate 读日志最频繁的时候）。
3. 重复 5.1 的账号切换，记录 3 次平均值 `T1`。
4. 再在 Codex **空闲**时重复 3 次，记录 `T2`。

**判定：**

- `T1` 与 `T0` 差值 **< 0.3 秒**，且无肉眼可见卡顿/白屏 → 通过；
- 差值 0.3–1 秒或偶发卡顿 → 记录为“需优化”，附具体现象；
- 明显卡死、切换失败、Cockpit 崩溃 → 失败，停止验收并反馈。

### 5.3 资源占用（任务管理器）

1. 任务管理器 → 详细信息 → 右键列标题 → 勾选 **CPU、内存（专用工作集）、磁盘**。
2. 分三个时段各记录 3 个采样（间隔 10 秒取中位数）：

| 时段 | CPU | 内存 | 磁盘 |
| --- | --- | --- | --- |
| Codex 空闲、Cockpit 静止 | ____% | ____ MB | ____ MB/s |
| Codex 正在生成回答 | ____% | ____ MB | ____ MB/s |
| Cockpit 连续切换账号 | ____% | ____ MB | ____ MB/s |

**参考阈值（不是硬标准，超出要解释）：**

- 空闲：CPU < 1%，内存 < 200 MB，磁盘 < 0.5 MB/s；
- 生成中：CPU < 5%（单核口径），内存 < 300 MB；
- 切换账号时：Tokrate 不应出现持续 > 10% CPU 或 > 5 MB/s 磁盘。

命令行采样（可选，复制到 PowerShell）：

```powershell
1..6 | ForEach-Object {
  Get-Process Tokrate-CN -ErrorAction SilentlyContinue |
    Select-Object @{n='Time';e={Get-Date -Format HH:mm:ss}}, CPU, WorkingSet64, Id
  Start-Sleep -Seconds 10
}
```

### 5.4 日志删除/轮转冲突

1. Tokrate 保持运行，Codex 空闲。
2. 在 `%USERPROFILE%\.codex\sessions` 里删除一个**最旧**的会话文件：
   - 删除成功 → 通过；
   - 提示占用 → 用 4.3 的方法确认是 Tokrate 还是 Codex 自己占用（Codex 可能持有当前会话）。
3. 让 Codex 继续产生新会话，观察 Tokrate 是否能发现新文件（数值更新）。

---

## 6. 安全与卸载确认（人工，3 分钟）

| # | 操作 | 通过标准 |
| --- | --- | --- |
| 6.1 | 打开“凭据管理器 → Windows 凭据”，搜索 `dev.tokrate.desktop` | 未开启共享时应**没有**条目；开启过共享则会有，属预期 |
| 6.2 | 若 6.1 有条目：退出程序、删除整个文件夹后重新查看 | 条目仍在 → 记录“卸载残留”，按 04 文档手动删除 |
| 6.3 | 检查 `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall` | 没有 Tokrate 卸载项 |
| 6.4 | `%APPDATA%`、`%LOCALAPPDATA%` 下 | 没有便携版新建的 Tokrate 目录（官方版目录除外） |
| 6.5 | 删除整个便携文件夹后重新解压 | 能重新启动，且是全新状态（除非你保留了 data） |

---

## 7. 汇总表（反馈时请直接贴这张表）

| 项目 | 结果 | 证据/备注 |
| --- | --- | --- |
| 自动化脚本失败项数 | ____ | 附 `acceptance.json` |
| 基础可用性 2.1–2.7 | ____/7 | |
| 不写 %LOCALAPPDATA% | □ 通过 □ 失败 | |
| 移动文件夹后数据保留 | □ 通过 □ 失败 | |
| 日志哈希不变 | □ 通过 □ 失败 | |
| Codex 空闲时可重命名日志 | □ 是 □ 否 | |
| Cockpit 切换 T0 / T1 / T2 | ____ / ____ / ____ 秒 | 各 3 次平均 |
| 是否肉眼卡顿 | □ 无 □ 偶发 □ 明显 | |
| CPU/内存/磁盘峰值 | ____ / ____ / ____ | |
| 凭据管理器残留 | □ 无 □ 有 | |
| 汉化完成度 | ____%（见 02 文档脚本） | |

**整体判定：**

- 全部通过（汉化项除外）→ 可发布，汉化作为已知限制写入发布说明；
- 任一“失败”出现在数据路径、日志占用、Cockpit 卡顿 → 不建议发布，先修；
- 汉化未完成 → 按项目要求，**不满足“中文便携版”的验收定义**，需 B 完成后重跑 02 与本节 2.3–2.7。
