# 05 · 安全与隐私审查（Tokrate-CN Portable）

- 审查对象：`tokrate-cn` 工作区（Fork：alexrwaa/tokrate-clients-c），HEAD `d9955c7` + 2026-11-16 的未提交改动
- 审查方式：逐文件阅读 + `grep` 全量检索；所有结论给出 `文件:行号`
- 限制：**没有运行二进制**，没有抓包，没有在真实 Cockpit 环境测试；运行期行为标注为“未验证”
- 上游已有的安全模型（C01–C16）不在本文件重复论证，本文件只回答“便携版/汉化改动是否引入了新问题”

---

## 1. 结论总表

| # | 审查问题 | 结论 | 关键证据 |
| --- | --- | --- | --- |
| 1 | 是否写入 Codex OAuth 凭证 / 修改 Codex 配置 | **否**，只读 `sessions` 目录 | `runtime.rs:112-114,141`、`reader.rs:46`、`sqlite_read.rs:60` |
| 2 | 是否修改 Cockpit 数据 | **否**，代码中不接触 Cockpit 路径 | 全仓库仅 `desktop/core/tests/cockpit_contention.rs:15` 的注释提及 |
| 3 | 是否有上传本地日志的代码路径 | **有上传，但只传数值白名单，且默认关闭、需明示同意** | `sharing.rs:48-83`、`runtime.rs:1345,1417-1421` |
| 4 | 是否新增外部网络请求 | **没有新增**；反而移除了更新检查 | `tauri.conf.json`（无 `plugins.updater`）、`build.rs:31-41` |
| 5 | 社区共享密钥如何保存，便携模式是否明文落盘 | **存 Windows 凭据管理器（DPAPI），不落 `data/`**；但与官方版共用条目名，删文件夹不会删凭据 | `runtime.rs:1218-1238`、`Cargo.toml:28` |
| 6 | 是否要求高权限 | **否**，无管理员清单；便携运行不需要安装器 | `tauri.conf.json:38`、`capabilities/default.json` |

---

## 2. 逐项证据

### 2.1 Codex OAuth 凭证与配置

**结论：不读取、不写入、不修改。**

- 默认只拼接 `sessions` 子目录，不指向 `.codex` 根：
  - `desktop/src-tauri/src/runtime.rs:112-114`：`CODEX_HOME` 或 `home.join(".codex")`
  - `desktop/src-tauri/src/runtime.rs:141`：`root: codex_home.join("sessions")`
- 文件读取是只读打开，且拒绝非普通文件：
  - `desktop/core/src/reader.rs:45-47`：`OpenOptions::new().read(true)`（没有 `write`/`create`）
- SQLite 以只读 URI 打开，明确不用 `immutable`：
  - `desktop/core/src/sqlite_read.rs:38`：追加 `?mode=ro`
  - `desktop/core/src/sqlite_read.rs:60-63`：`SQLITE_OPEN_READ_ONLY`
- 全仓库生产代码中没有 `auth.json` / `config.toml` 的读写；`auth.json` 只出现在测试夹具（如 `desktop/core/src/antigravity_tests.rs:1802`、`opencode_tests.rs:2048`）。
- 便携化改动只改变**本程序自己**的数据目录（`portable.rs:47-62`），不触碰被监测工具目录。

> 未验证：Windows 上是否会对日志文件持有共享锁导致 Codex 无法删除/轮转，需要本机用 Process Explorer 观察（见 06）。

### 2.2 Cockpit 数据

**结论：不接触。**

- 全仓库检索 `cockpit` 只有两处，均在新增压力测试文件：
  - `desktop/core/tests/cockpit_contention.rs:15`（注释：需在本机与真实 Cockpit 同跑）
  - 同文件 `:18`（指向 01 文档）
- 生产代码没有 Cockpit 的路径、数据库、进程名或窗口句柄操作。
- Tokrate 的写操作只发生在 `data/`（`portable.rs:68-79`）与系统凭据库（`runtime.rs:1231-1233`）。

### 2.3 上传本地日志的路径与真实行为

**结论：存在社区上传，但内容是固定字段白名单；默认关闭；关闭时停止请求。**

- 默认值：`desktop/src-tauri/src/runtime.rs:132` `sharing: false`；`:133` 无同意记录。
- 授权条件（开关 + 当前版本同意 + 已接受）：
  - `runtime.rs:154-159`：`sharing_authorized()`
  - `runtime.rs:1345`：未授权时直接 `Local only` 返回，不启动网络任务
- 上传结构体是显式字段白名单，没有路径、会话 ID、提示词、回答：
  - `desktop/core/src/sharing.rs:48-83`：`sample_id/observed_at/client/model/provider/output_tokens/duration_ms/...`
- 请求目标与头部：
  - `runtime.rs:28`：`https://tokrate.dev/api/public/v1`
  - `runtime.rs:1417-1421`：`POST {API}/samples`，`X-Tokrate-Key`、`X-Tokrate-Signature`，body 为签名 JSON
- 客户端约束：
  - `runtime.rs:1358-1364`：UA 只有 `Tokrate/<version>`、`https_only(true)`、`redirect(Policy::none())`、20s 超时
- 社区看板拉取（同样只在授权后）：
  - `runtime.rs:1482`：`GET {API}/board`
- 队列只在内存，24 小时/1000 条上限：
  - `sharing.rs:23`、`sharing.rs:35`
- 关闭共享的处理：
  - `runtime.rs:1335-1354`：`restart_sharing` 先 `abort` 网络任务、`queue.disable()`、`drop_board()`，再判断授权

**没有发现**把 `sessions/*.jsonl` 原文、文件路径或提示词放进请求体的代码路径。

### 2.4 外部网络请求清单（对比原版）

| 请求 | 触发条件 | 是否便携版新增 | 证据 |
| --- | --- | --- | --- |
| `POST https://tokrate.dev/api/public/v1/samples` | 用户同意共享且有新样本 | 否（上游行为） | `runtime.rs:1417-1421` |
| `GET https://tokrate.dev/api/public/v1/board` | 共享开启期间按节奏拉取 | 否 | `runtime.rs:1482` |
| `https://tokrate.dev` / `/privacy` / `/terms` / `/download` | 用户点击菜单/链接，交给系统浏览器 | 否 | `main.rs:261-269` |
| 更新检查 `https://tokrate.dev/updates/...` | 原版会请求 | **便携版已移除** | `tauri.conf.json` 无 `plugins.updater`；`build.rs:31-41` 构建期断言 |
| GitHub Releases 更新包 | 原版更新安装 | **便携版不可用** | `updater_state.rs:221-235`：无 bundle 类型时 `UpdateMode::Unavailable` |

便携版没有引入任何新的域名、统计 SDK 或崩溃上报。依赖清单中未发现 analytics/telemetry：
`desktop/package.json:12-17` 只有 React、lucide、Tauri API；`Cargo.lock` 检索 sentry/posthog/segment 等为空（检索命令见第 5 节）。

### 2.5 社区共享密钥与便携模式落盘

- 使用 `keyring` 3.6.3 的 `windows-native` 后端：`desktop/src-tauri/Cargo.toml:28`。
- 条目名与读取/创建逻辑：
  - `runtime.rs:1218-1219`：`Entry::new("dev.tokrate.desktop", "contribution-signing-key-v1")`
  - `runtime.rs:1221-1237`：已存在则读取；不存在则用 `OsRng` 生成 32 字节并 `set_secret`
  - 密钥用 `Zeroizing` 包裹，离开作用域即清零
- **便携模式不会把它写进 `data/`**：`portable.rs` 只创建目录，代码中没有把密钥写入文件的路径；`data/` 中只有设置、历史、更新偏好、WebView2 配置。
- 存储位置是 Windows 凭据管理器（DPAPI 按当前用户加密），属于系统凭据库，不是明文文件。

**但有两个真实副作用（见 3.1、3.2）：**

1. 删除便携文件夹**不会**删除凭据管理器里的条目 → “卸载=删文件夹”不完全成立；
2. 条目名仍是 `dev.tokrate.desktop`，与官方版相同 → 两版共用同一个匿名身份，贡献记录可被关联。

### 2.6 权限与攻击面

- 无管理员清单：仓库中没有 `requireAdministrator`；Tauri 默认生成 `asInvoker`。便携包不包含 NSIS 安装器。
- 安装器配置即便存在也是当前用户级：`tauri.conf.json:38` `installMode: currentUser`。
- IPC 能力最小化：`desktop/src-tauri/capabilities/default.json` 仅授予 19 个 `allow-<命令>`，无 `core:*`、无文件系统/HTTP/shell 插件权限。
- CSP 严格，禁止远程脚本与表单：
  - `tauri.conf.json:28`：`default-src 'self'; connect-src ipc: http://ipc.localhost; script-src 'self'; object-src 'none'; form-action 'none'`
- WebView2 配置目录被重定向到便携目录：
  - `portable.rs:26`、`portable.rs:94-98`：设置 `WEBVIEW2_USER_DATA_FOLDER`
  - 只改这一个变量，未改 `APPDATA/LOCALAPPDATA/TEMP`（`portable.rs:91-93` 注释与实现一致）

---

## 3. 发现的风险（按严重度）

### 3.1 【中】删除文件夹后凭据管理器仍残留共享身份，且与官方版共用条目

- 证据：`runtime.rs:1219` 固定服务名 `dev.tokrate.desktop`；`tauri.conf.json:5` 产品标识已改为 `dev.tokrate.cn.portable`，但 keyring 服务名没跟着改。
- 影响：
  1. 用户以为“删文件夹=彻底卸载”，但 Windows 凭据管理器里仍保留一条匿名签名密钥；
  2. 便携版与官方版会复用同一密钥，两边的社区贡献在服务端可被关联为同一身份（不含账号信息，但匿名性弱于“每装一份一个身份”）。
- 建议：改用独立服务名（如 `dev.tokrate.cn.portable`），并在用户指南/卸载步骤中给出凭据管理器清理方法（04 文档已写入）。
- 状态：**未修复**，需 C/A 决定是否改服务名。

### 3.2 【低】`data/` 的访问控制继承父目录

- 证据：`desktop/core/src/private_file.rs` 在 Unix 上把临时文件设为仅属主可读，但 Windows 走 `NamedTempFile::persist`，继承所在文件夹的 ACL。
- 影响：若用户把便携版放在 `D:\` 根或共享目录，同机其他用户可能读取 `history.json`（其中是模型名、token 数、目录检查点摘要，不含对话正文）。
- 建议：文档提示“放在个人可写目录，不要放在共享/公共目录”；如需更强隔离，可对 `data/` 设置仅当前用户 ACL（未实现）。

### 3.3 【中】共享同意页仍是英文

- 证据：`desktop/ui/components/SharingChoice.tsx` 13 处英文（见 02 文档第 4 节）。
- 影响：中文用户可能在不理解“会上传什么”的情况下点同意，削弱“明示同意”的实际效果。
- 建议：发布前必须完成该页汉化，且中文文案需与 `sharing.rs:48-83` 的真实字段一一对应。

### 3.4 【低】便携目录内的 exe 可被同机其他用户替换

- 便携软件固有属性：`data/` 与 exe 同目录，若目录权限过宽，其他本地用户可替换 exe。
- 影响：属于“已能写你目录的人可以做更多事”的威胁模型，不构成额外提权。
- 建议：文档提示放在个人目录；不引入代码签名之外的额外机制。

### 3.5 【信息】WebView2 环境变量是进程级

- `portable.rs:97` 设置的是当前进程环境变量，不会写入系统环境，也不会影响其他程序；但若未来在同一进程内启动子进程，会继承该变量。当前没有子进程。

### 3.6 【信息】更新相关命令仍注册但不可用

- `main.rs:326` 仅在 `updater_plugin_enabled()` 为真时注册插件；便携运行（无 bundle 类型）时 `Updater` 不可用。
- `install_update` 有二次校验（`main.rs:174`）与 URL 白名单（`updater_state.rs:12-25`）。
- 影响：界面“检查更新”可能返回错误文案；属于体验问题，不是安全问题。建议 UI 在便携模式下隐藏更新入口（未验证是否已处理）。

---

## 4. 明确未验证的部分

| 项目 | 原因 |
| --- | --- |
| 是否对 Codex 日志文件持有共享锁、是否阻止删除/轮转 | 需要运行二进制并用 Process Explorer 查句柄，见 06 |
| 上传请求的真实抓包内容 | 需要开启共享并抓包；本次只做代码级审查 |
| Windows 凭据管理器中条目的实际名称与可见性 | 未运行程序、未实际创建条目 |
| 官方版与便携版同时运行时的单实例互斥行为 | 需要两版二进制同机运行 |
| Cockpit 同跑时的资源占用 | 需要真实 Cockpit 环境，见 01/06 |
| `data/webview` 中 localStorage 的具体内容 | 未运行；代码只存语言偏好（`i18n/index.ts`），无其他业务数据证据 |

---

## 5. 复核命令（只读）

```bash
# 1) 确认没有 Cockpit 生产代码
grep -rn "cockpit" desktop --include=*.rs --include=*.ts --include=*.tsx | grep -v tests

# 2) 确认没有遥测依赖
grep -oiE '"(sentry|posthog|mixpanel|segment|amplitude|bugsnag|datadog|newrelic)[^"]*"' \
  desktop/package-lock.json desktop/core/Cargo.lock desktop/src-tauri/Cargo.lock

# 3) 确认所有外部 URL
grep -rnoE "https?://[a-zA-Z0-9._/{}:-]+" desktop/core/src desktop/src-tauri/src --include=*.rs | sort -u

# 4) 确认凭据管理器的服务名
grep -rn "keyring::Entry::new" desktop/src-tauri/src

# 5) 确认更新器已移除
grep -n "updater" desktop/src-tauri/tauri.conf.json || echo "no updater config"
```

---

## 6. 总体结论

**可以合并，但发布前必须处理 3.1 与 3.3。**

- 便携化改造本身没有引入新的网络请求、遥测或提权需求；
- 数据写入被限制在 `data/`，且写入失败时明确报错而不是回退系统盘，符合设计目标；
- 社区共享仍是“默认关闭 + 明示同意 + 数值白名单”，与上游一致；
- 主要问题是“卸载不彻底（凭据管理器残留/共用身份）”和“合规文案未汉化”，都属于可修复项，不构成阻断合并的安全缺陷。
