# 03 · 验收报告（Tokrate-CN Portable）

- 验收对象：`tokrate-cn` 分支（Fork：alexrwaa/tokrate-clients-c）
- 代码基线：HEAD `09f5aeb09755df306b8b1cc21f00fae599cc3e2b`（即成功 CI run 构建的提交）；初次静态验收快照为 `d9955c7`
- 验收人：Agent D（独立测试与质量）
- 验收方式：只读代码审查 + 脚本自检 + **GitHub Actions 实跑证据**（Windows x64 runner）
- **本报告不包含任何未实际产生的构建/CI/真机结果**；没有证据的项目一律标注“未验证”

> 本版相对初版的差异：第 6 节由“待 CI 回填”改为真实 run 证据；第 4 节由“无实测数据”改为 CI 实测数字；
> 第 1 节逐项改为四态结论；新增 6.3 问题记录（两次失败 run）与 6.4 Release 状态。
> 本地化相关结论仍停留在初版快照，本次**未重跑**审计，故不升级为通过。

---

## 证据索引

| 类别 | 内容 |
| --- | --- |
| 成功构建（run #43905944040，attempt 1） | https://github.com/alexrwaa/tokrate-clients-c/actions/runs/43905944040 |
| 成功 run 关键事实 | workflow `Tokrate-CN Windows x64 portable`；分支 `tokrate-cn`；head `09f5aeb09755df306b8b1cc21f00fae599cc3e2b`；job 结论 success；`package=success`、`verify=success` |
| 失败 run #43903153446 | `Set up job` 即失败：`Unable to resolve action Swatinem/rust-cache@6323deb… unable to find version`；修复=固定 SHA 改为官方主版本标签 |
| 失败 run #43903556973 | 测试与 smoke 断言全通过，但 `native-smoke.py` 退出时 `TemporaryDirectory` 清理抛 `PermissionError [Win32]`（WebView2 子进程仍持有 `webview\EBWebView\Default\Extension Rules\000003.log`）；修复=`ignore_cleanup_errors=True` |
| 产物 ZIP | `Tokrate-CN-Portable-win-x64.zip`，6,977,246 字节（6.7 MiB），sha256 `9c3ed979912d0fcbcdab4521ad1d6a340c475ca0263fd9a0fd6dad0cac5976ff` |
| 包内 EXE | 更名为 `Tokrate-CN.exe`；源 `tokrate-desktop.exe` 18,591,232 字节，sha256 `908cffb6cfc3335843ae1c2ca33eff02dc0da0a3f914d147352bb6b21bef18cd` |
| Release | 本次为分支构建，**尚未产出**；tag `cn-portable-latest` 仅在推送 `main` 或 tag 时发布，链接占位 `{{RELEASE_URL}}` |

---

## 0. 一句话结论

**自动化可验证的部分已全部通过，但仍不适合直接对外发布。** 成功 run #43905944040 在 Windows x64 runner 上
完成了构建、四组测试、native webview smoke 与 7 项便携运行期验证（0 skipped / 0 failed），产物与校验和齐全；
剩余缺口集中在**必须人工或真机**的项目：与真实 Cockpit Tools 同跑、移动硬盘/U 盘运行、缩放与托盘/通知观感、
中英切换视觉确认、与官方版同机共存实测，以及中文本地化仍未清零。
可对外发布的唯一路径是合并到 `main` 触发 Release（本次分支构建不产出 Release）。

| 维度 | 状态 | 依据 |
| --- | --- | --- |
| 便携数据布局 | **已验证通过** | CI `portable-verify.py` 7/7：archive / webview / no_c_drive / shutdown / relocation / single_instance / fault_path |
| 打包与 CI | **已验证通过** | run #43905944040，package=success、verify=success；ZIP 6,977,246 字节，sha256 已核对 |
| 中文本地化 | **未通过** | 初版快照 39 处硬编码 / 10 文件；本次未重跑审计，状态不升级 |
| 语言切换 | **部分通过** | 功能已实现；自动化只覆盖默认中文渲染与 key 完整性，人工切换观感未验证 |
| Codex 目录识别 | **部分通过** | 代码与单测覆盖；未在 CI 上做真实 `~/.codex/sessions` 识别运行验证 |
| Cockpit 兼容 | **部分通过** | 读取上限与并发压测已实测；真实同跑未验证（云端无该环境） |
| 性能 | **已验证通过（CI 机器）** | 100/1000/10000 文件三档实测，单轮读取恒定 ~7KB；同机同跑开销未测 |
| 安全与隐私 | **部分通过** | 代码级审查通过；凭据残留（R2）、同意页未汉化（R1）仍在 |

---

## 1. 开发完成情况表

状态定义：**已验证通过**（有可复现证据）/ **部分通过**（实现存在但缺关键环节）/ **未验证**（有实现但未运行/未测量）/ **失败**（实测不满足）。

| # | 验收项 | 状态 | 证据来源 |
| --- | --- | --- | --- |
| 1 | 仓库与分支就绪（`tokrate-cn`） | 已验证通过 | CI 从 `tokrate-cn` 分支 head `09f5aeb` 检出并构建成功（run #43905944040） |
| 2 | 便携数据目录 `<exe>/data`，无 C 盘回退 | 已验证通过 | `portable.rs:47-79`；CI `portable-verify.py` 的 `no_c_drive` / `fault_path` 两项实测通过 |
| 3 | WebView2 配置写入 `data/webview` | 已验证通过 | `portable.rs:26,94-98`；CI `webview` 项：从无关工作目录启动后 `data/webview/` 出现 `EBWebView` 且有新写入 |
| 4 | 不写 `%LOCALAPPDATA%` / `%APPDATA%` | 已验证通过 | CI `no_c_drive` 项：两目录下无新增或修改的 Tokrate 目录 |
| 5 | 便携 ZIP 打包（exe + 空 data/ + 中文 README） | 已验证通过 | `package-portable.mjs` 在 CI 实跑；ZIP 6,977,246 字节，sha256 `9c3ed979…5976ff` |
| 6 | CI 构建 Windows x64 便携包 | 已验证通过 | run #43905944040：job success，`package=success`、`verify=success` |
| 7 | 中文本地化（界面） | **失败（未通过）** | 初版快照 39 处硬编码 / 10 文件（`i18n-coverage-audit.mjs`）；本次未重跑，故不升级 |
| 8 | 语言切换入口 | 部分通过 | `Settings.tsx:123-137,206`；自动化仅覆盖默认中文渲染与 key 完整性，人工切换走查未做 |
| 9 | Rust 侧可见文案汉化 | 部分通过 | 托盘菜单/提示/对话框标题已中文；运行时状态仍英文（`runtime.rs:689,755,841,1454`）；托盘/通知观感未人工确认 |
| 10 | Codex 会话目录识别（`CODEX_HOME` / `~/.codex/sessions`） | 部分通过 | `runtime.rs:112-114,141`；Rust core 403 项测试通过，但未做真实目录识别的运行验证 |
| 11 | 多数据源检测与手动指定 | 部分通过 | `sources.rs`、`main.rs:choose_folder`；CI 无多源样本，仅单测覆盖 |
| 12 | 监测开关 | 部分通过 | `runtime.rs:809` 暂停 poll；`watch_targets()` 未检查开关（01 §3.2，补丁仍未应用） |
| 13 | 与官方版共存 | **未验证** | 标识已隔离为 `dev.tokrate.cn.portable`（`tauri.conf.json:5`）；同机同时安装未实机验证；keyring 服务名未改（R2） |
| 14 | 不写 Codex 凭证/配置 | 部分通过 | 只读打开（`reader.rs:46`），无 `auth.json` 生产代码；未做 `--launch` 前后哈希对比 |
| 15 | 普通用户权限 | 部分通过 | 无 `requireAdministrator`；CI runner 账户权限与终端用户不一致，未在标准用户实测 |
| 16 | 卸载 = 删除文件夹 | 部分通过 | 无卸载注册表项；`shutdown` 项证明删除进程后 `data/` 仍在，但凭据管理器条目会残留（05 §3.1） |
| 17 | Cockpit 兼容性分析 | 已验证通过（分析） | `docs/cn-portable/01-cockpit-perf.md`；代码级结论完整，真机同跑仍缺（见 3.4） |
| 18 | 读取路径重复 open 修复 | 已验证通过 | `desktop/core/src/reader.rs` 已在 CI 编译；`cargo test` 403 passed、`cockpit_contention` 10 passed |
| 19 | 性能数据 | 已验证通过（CI 机器） | 100/1000/10000 文件三档数字见第 4 节；`--nocapture` 原始输出 |
| 20 | 便携运行期验证脚本（CI 实跑） | 已验证通过 | `desktop/scripts/portable-verify.py`：7 项全 pass、0 skipped、0 failed（明细见 6.2） |
| 21 | native webview smoke | 已验证通过 | `{"nativeWebview": true, "parsedFixture": true, "sharingOff": true, "updatesOff": true}` |
| 22 | 本地验收脚本 | 已验证通过 | `portable-acceptance.py`：`py_compile` 通过，真实目录跑通 12 项（失败项因目录无 exe，符合预期） |
| 23 | 汉化审计脚本 | 已验证通过 | `node desktop/scripts/i18n-coverage-audit.mjs` 正常输出，退出码 0 |
| 24 | 安全审查 | 已验证通过 | `docs/cn-portable/05-security-review.md`，结论均有 `文件:行号` |
| 25 | 用户文档与本机验收步骤 | 已验证通过 | `04-user-guide-zh.md`、`06-local-verification-steps.md` |
| 26 | 前端单元测试回归 | 已验证通过 | `npm test` 13 个测试文件全部通过（vitest）；初版的 `test-setup.ts` 导入错误（R11）已消除；`npm run build`（tsc --noEmit + vite build）通过 |

---

## 2. 中文本地化覆盖范围

完整清单见 `docs/cn-portable/02-localization-audit.md`，此处只给结论：

| 区域 | 状态（验收时刻） |
| --- | --- |
| 托盘菜单、tooltip、窗口标题、选目录对话框 | 已汉化 |
| 设置页（含语言切换） | 已清零（本次扫描未检出硬编码） |
| 仪表盘头部 / Hero / 模型列表 / 趋势 | 已接入 `t()`，共残留 5 处（多为单位或单条标签） |
| 历史记录 / 社区 / 首次引导 | 已清零（本次扫描未检出） |
| 效率说明 / 更新页 | 未汉化（17 处） |
| 共享同意页 / 同意弹层 | 未汉化（15 处）；**合规风险** |
| 运行时状态栏（Rust） | 未汉化（英文常量） |

> 扫描时刻的准确数字：**39 处硬编码 / 10 个文件 / 35 个源文件**（数值在验收期间持续下降：
> 23:05 为 160 处，23:18 为 49 处，23:20 为 39 处）。发布前必须重跑并清零；
> 本报告不以“正在下降”替代“已通过”。

> 本版补充：CI 成功 run **不包含** `i18n-coverage-audit.mjs`，因此上面的数字仍是初版快照，
> 本次未重跑、也不推定已清零。自动化目前只覆盖默认中文渲染与 key 完整性，
> **中英文切换后的人工视觉确认属“未验证”**（见 6.5）。

---

## 3. Cockpit 兼容性

### 3.1 结论摘要（引用 01，不复制其推测）

01 文档的代码级结论：

1. 读取有硬上限：每轮 poll 最多 1 MiB 内容、最小间隔 2 s（`sources.rs:18`、`schedule.rs:10`）；
2. 对源目录**不写、不改名、不删除**，且不使用 `share_mode`/`flock`/`LockFileEx`，Windows 默认共享模式不会阻止 Cockpit 打开同一文件；
3. “Tokrate 的进程内锁导致 Cockpit 卡死”不成立（跨进程无效）；真正可能放大的是首次全量回放、目录枚举与每次 open 的杀软过滤开销；
4. 上述量级均属 **B 级（机制可证、数值需实测）**；第 4 节已用 CI 实测补上“读取量与目录规模无关”的数值，
   但“与 Cockpit 同跑不卡顿”仍属未验证。

### 3.2 已修复并已验证项

- **每个 reader 每轮重复 `open` 同一文件** → 改为单次 open、同一句柄完成 stat/seek/read：
  `desktop/core/src/reader.rs`（`read_at` 改为接收 `&mut File`，`poll_records` 只 open 一次）。
- 副作用修正：消除了“按旧 size 读新文件”的竞态。
- 新增压力测试 `desktop/core/tests/cockpit_contention.rs`：CI 实测 `test result: ok. 10 passed; 0 failed`（7.77s）。
  该测试在同一 CI 机器上用 `--nocapture` 输出，量化了“单轮读取量与目录规模无关”（见第 4 节）。

### 3.3 明确未修复（01 已给出 patch，未落地）

| 项 | 位置 | 影响 |
| --- | --- | --- |
| 暂停监测后 watcher 仍持有句柄/线程 | `runtime.rs:784`、`watcher.rs:299` | “暂停”不等于停止碰目录；约 9 个句柄、9 个线程保留 |
| Runtime 互斥锁覆盖整轮 poll | `runtime.rs:1273-1275` | 只影响 Tokrate 自身 flyout，不影响 Cockpit |

### 3.4 必须标注的前提

> **真实 Cockpit 同跑验收必须由用户在本机完成。** CI（Linux/Windows runner）没有 Cockpit 本体、
> 没有 `ReadDirectoryChangesW` 的真实缓冲行为、没有 NTFS 目录项陈旧与 Defender 过滤，
> 不能替代同跑观察。操作步骤见 `06-local-verification-steps.md` 第 5 节（含 5–10 分钟观察法与判定阈值）。

---

## 4. 性能

以下数字来自 CI 成功 run #43905944040 的同一台 Windows x64 runner，`cargo test -- --nocapture` 原始输出，
不是推算值。测试环境：node v22.23.4、rustc/cargo 1.100.0、Python 3.12.10、WebView2 Runtime 156.0.4314.58。

### 4.1 目录规模压力测试（`cockpit_contention`）

| 目录文件数 | 建文件耗时 | 首轮（含目录发现） | 单轮最多读取 | 8 轮累计读取 |
| --- | --- | --- | --- | --- |
| 100 | 67.12 ms | 14.29 ms | 7,008 字节 | 43,578 字节 |
| 1,000 | 769.32 ms | 74.31 ms | 7,032 字节 | 43,680 字节 |
| 10,000 | 3.79 s | 178.68 ms | 7,056 字节 | 43,776 字节 |

**结论：单轮读取量与目录规模无关（恒定在 ~7KB/轮），首轮耗时随文件数近似线性增长，10000 文件仍 < 180ms。**
8 轮累计读取在 43.5–43.8KB 之间，说明读取上限由每轮窗口决定，不随目录膨胀。

### 4.2 其余指标

| 指标 | 状态 | 获取方式 |
| --- | --- | --- |
| 每轮读取字节 / open 次数 | 已验证通过（CI） | 上表 `--nocapture` 输出 |
| 100 / 1000 / 10000 文件的首轮耗时与单轮读取上限 | 已验证通过（CI） | 上表 |
| 空闲 CPU / 内存 / 磁盘 | **未验证** | 需本机 06 §5.3 采样（CI runner 无桌面会话，数字无参考价值） |
| 与 Cockpit 同跑时的账号切换延迟 T0/T1/T2 | **未验证** | 需本机 06 §5.1–5.2（云端无 Cockpit 本体） |
| 首次全量回放时长 | **未验证** | 需本机清空 `data/` 后观察 |

> 上述 CI 数字只证明“读取路径与目录规模的量级关系”，**不能替代**与真实 Cockpit 同跑的卡顿验收。

---

## 5. Portable 实现原理与真实数据路径

以下描述基于当前工作区代码，不是设想结构。

### 5.1 启动顺序

1. `main()` 第一步解析数据根（`main.rs:291-303`）：
   - 普通运行：`portable::portable_root()` → `current_exe()` 的父目录 + `data`；
   - `--smoke-test`：使用 `TOKRATE_SMOKE_DIR`，与真实数据隔离。
2. `portable::prepare()`（`portable.rs:68-79`）创建并验证可写：
   - `data/`、`data/cache/`、`data/logs/`、`data/webview/`；
   - 在 `data/cache/.write-probe` 写入后删除，证明目录真的可写（只 `create_dir_all` 不够）。
3. 失败时**不回退 C 盘**，直接弹中文错误框并 `exit(1)`（`portable.rs:5-7`、`107-115`）。
4. `portable::initialize_webview_profile()` 设置 `WEBVIEW2_USER_DATA_FOLDER=data/webview`（`portable.rs:94-98`），在创建窗口之前完成。
5. `Runtime::load(data.root())`、`UpdateState::load(data.root())` 都使用同一目录（`main.rs:357` 起）。

> 上述 1–5 中的第 1、2、4 条已由 CI `portable-verify.py` 的运行期断言覆盖（第 6.2 节），
> 不再是“仅代码可读”的状态；第 3 条的失败路径由 `fault_path` 覆盖。

### 5.2 运行时写入的文件

| 路径 | 写入者 | 内容 |
| --- | --- | --- |
| `data/settings.json` | `runtime.rs:547` | 开关、数据源目录、共享同意记录 |
| `data/history.json` | `history.rs:82-95` | 归一化指标 + 检查点（7 天 / 5 万条） |
| `data/update-preferences.json` | `updater_state.rs:216` | 更新检查偏好 |
| `data/webview/**` | WebView2 | 缓存、localStorage（语言选择） |
| `data/cache/**` | 应用 | 临时文件与写探针 |
| `data/logs/**` | 当前无写入者 | 目录预留；`grep` 未发现文件日志实现 |

### 5.3 网络与更新

- 便携版**移除**了更新器配置：`tauri.conf.json` 无 `plugins.updater`，`build.rs:31-41` 在构建期断言；
- 无 bundle 类型时 `UpdateMode::Unavailable`（`updater_state.rs:221-229`），插件不注册（`main.rs:326`）；
- 保留的社区上传逻辑不变：仅用户同意后请求 `https://tokrate.dev/api/public/v1`（`runtime.rs:28,1417,1482`）。

### 5.4 与官方版的关系

- 产品标识改为 `dev.tokrate.cn.portable`（`tauri.conf.json:5`），数据目录完全独立；
- **但 keyring 服务名仍是 `dev.tokrate.desktop`**（`runtime.rs:1219`），见风险 R2。

---

## 6. GitHub Actions 结果

### 6.1 成功 run

| 项目 | 实测值 |
| --- | --- |
| workflow | `Tokrate-CN Windows x64 portable`（`.github/workflows/desktop.yml`） |
| run id / attempt | `43905944040` / attempt 1 |
| 分支 / head commit | `tokrate-cn` / `09f5aeb09755df306b8b1cc21f00fae599cc3e2b` |
| runner | Windows X64；node v22.23.4；npm 10.9.9；rustc 1.100.0；cargo 1.100.0；Python 3.12.10；WebView2 Runtime 156.0.4314.58 |
| job 结论 | **success**；`package=success`、`verify=success` |
| 构建页 | https://github.com/alexrwaa/tokrate-clients-c/actions/runs/43905944040 |

### 6.2 测试与校验（同一次 run）

| 步骤 | 结果 | 状态 |
| --- | --- | --- |
| 前端 `npm test`（vitest） | 13 个测试文件全部通过 | 已验证通过 |
| 前端 `npm run build`（tsc --noEmit + vite build） | 通过 | 已验证通过 |
| Rust core `cargo test` | `test result: ok. 403 passed; 0 failed`（69.95s） | 已验证通过 |
| 并发压测 `cockpit_contention` | `test result: ok. 10 passed; 0 failed`（7.77s） | 已验证通过 |
| Tauri crate `cargo test --release` | `test result: ok. 129 passed; 0 failed; 1 ignored`（2.39s） | 已验证通过（1 项按设计 ignored） |
| native webview smoke | `{"nativeWebview": true, "parsedFixture": true, "sharingOff": true, "updatesOff": true}` | 已验证通过 |
| 便携验证 `portable-verify.py` | 7 项全 pass、0 skipped、0 failed | 已验证通过 |

便携验证 7 项明细（全部在 CI 里真跑）：

| # | 项 | CI 实测结论 | 状态 |
| --- | --- | --- | --- |
| 1 | `archive` | 解压到含空格与中文的路径 `…\Temp\Tokrate CN 便携 验证\run-4552-1794846232` 成功 | 已验证通过 |
| 2 | `webview` | 从无关工作目录启动后 `data/webview/` 出现 `EBWebView`，且启动后有新写入 → profile 确实被重定向 | 已验证通过 |
| 3 | `no_c_drive` | `%LOCALAPPDATA%` / `%APPDATA%` 下没有新增或修改任何 Tokrate 目录 | 已验证通过 |
| 4 | `shutdown` | 进程树被结束（code 1），`data/` 与其 WebView2 profile 仍在 | 已验证通过 |
| 5 | `relocation` | 整体移动到 `移动后的位置 with spaces\Tokrate-CN-Portable 移动` 后重启，仍写入移动后的 `data/webview/` | 已验证通过 |
| 6 | `single_instance` | 第二个实例 0.0s 内自行退出，第一个实例存活 | 已验证通过 |
| 7 | `fault_path` | `data` 被建成普通文件时，弹出标题为「Tokrate-CN 无法启动」的致命错误框，且没有任何 C 盘回退写入 | 已验证通过 |

### 6.3 问题记录（两次失败 run，真实调试过程）

| run | 失败点 | 现象/原因 | 修复 |
| --- | --- | --- | --- |
| `43903153446` | `Set up job` | `Unable to resolve action Swatinem/rust-cache@6323deb… unable to find version`——固定的 action SHA 在仓库侧不可解析 | 把所有固定 action SHA 换成官方主版本标签：`checkout@v4` / `setup-node@v4` / `dtolnay/rust-toolchain@stable` / `Swatinem/rust-cache@v2` / `upload-artifact@v4` |
| `43903556973` | `native-smoke.py` 退出清理 | Rust/测试/smoke 断言全部通过，但 `TemporaryDirectory` 清理抛 `PermissionError [Win32]`：WebView2 子进程仍持有 `webview\EBWebView\Default\Extension Rules\000003.log` | 改为 `ignore_cleanup_errors=True`（best effort 清理），不再把“进程未退干净”误判为 smoke 失败 |

> 说明：第二处修复是**放宽清理**，不是修复 WebView2 句柄释放时机。残留临时目录由 runner 回收，
> 不影响产物判定；但“WebView2 子进程在进程树结束后仍短暂持有文件”这一现象本身值得记录（见 R14）。

### 6.4 产物与 Release 状态

| 项目 | 实测值 | 状态 |
| --- | --- | --- |
| ZIP | `Tokrate-CN-Portable-win-x64.zip`，6,977,246 字节（6.7 MiB） | 已产出 |
| ZIP sha256 | `9c3ed979912d0fcbcdab4521ad1d6a340c475ca0263fd9a0fd6dad0cac5976ff` | 已核对 |
| 包内 EXE | 改名为 `Tokrate-CN.exe`；源 `tokrate-desktop.exe` 18,591,232 字节，sha256 `908cffb6cfc3335843ae1c2ca33eff02dc0da0a3f914d147352bb6b21bef18cd` | 已产出 |
| artifact | `Tokrate-CN-Portable-win-x64-<run_number>`，保留 14 天 | 可下载（有期限） |
| Release（tag `cn-portable-latest`） | 只在推送 `main` 或 tag 时发布；本次为分支构建，**尚未产出** | 待合并到 main 后由 Release 步骤产出，链接占位 `{{RELEASE_URL}}` |

> 因此当前“可分发性”只到 artifact 层：链接 14 天后失效，对外发布必须走 `main` 或打 tag。

### 6.5 明确未验证项（不得写成通过）

| # | 项目 | 状态 | 原因 |
| --- | --- | --- | --- |
| U1 | 与真实 Cockpit Tools 同时运行的卡顿验收 | **未验证** | 云端 runner 无 Cockpit 本体与真实 `ReadDirectoryChangesW`/Defender 行为 |
| U2 | 真机移动硬盘 / U 盘运行 | **未验证** | CI 仅有本地 NTFS 临时目录，无外接介质与热插拔场景 |
| U3 | Windows 缩放比例下的界面观感 | **未验证** | runner 无交互式桌面会话，无法目视 |
| U4 | 中英文切换的人工视觉确认 | **未验证** | 自动化只覆盖默认中文渲染与 key 完整性 |
| U5 | 托盘菜单与原生通知的中文显示观感 | **未验证** | 同上，需人工目视 |
| U6 | 官方版与本便携版同机共存实测 | **未验证** | 代码层面已用独立 identifier `dev.tokrate.cn.portable` 隔离，但未实机同时安装验证 |

---

## 7. 未解决问题与风险

| ID | 严重度 | 问题 | 证据 | 建议 |
| --- | --- | --- | --- | --- |
| R1 | 高 | 中文本地化未清零，共享同意页仍英文 | 02 全文；脚本输出 39 处（验收时刻） | B 完成剩余 10 个文件；同意页优先；发布门禁设为 0 硬编码 |
| R2 | 中 | 删除文件夹后凭据管理器残留，且与官方版共用身份 | `runtime.rs:1219`；05 §3.1 | 改用独立服务名；文档已写清理方法 |
| R3 | 低 | 语言切换已实现，但切换后的全局刷新未验证 | `Settings.tsx:123-137` | 本机切换一次并走查各页面（06 可补一项） |
| R4 | 中 | 暂停监测后 watcher 未释放 | 01 §3.2；`runtime.rs:784` 未改 | 应用 01 的 8 行 patch 并跑回归 |
| R5 | 已关闭 | reader.rs 改动未编译/未跑测试 | run #43905944040：编译通过，core 403 passed、`cockpit_contention` 10 passed | 保持 CI 必跑 `cargo test -p tokrate-core` |
| R6 | 中 | 缺真机证据（CI 证据已有） | 第 6 节成功 run；6.5 的 U1–U6 仍未验证 | 按 06 文档在本机逐项走查并回填 |
| R7 | 低 | 运行时状态文案仍英文 | `runtime.rs:689,755,841,1454` | 与 B 统一迁移到字典 |
| R8 | 低 | `data/` ACL 继承父目录 | `private_file.rs` Windows 分支 | 文档提示放个人目录；可选 ACL 加固 |
| R9 | 低 | 便携版 UI 仍有“检查更新”入口但更新器不可用 | `main.rs:326`、`updater_state.rs:221` | 便携模式隐藏更新区或显示“便携版不自动更新” |
| R10 | 信息 | `data/logs/` 为空目录，文档需说明 | `portable.rs:69` | 已在 04 文档注明“可能为空” |
| R11 | 已关闭 | 前端测试 12/12 文件无法加载（`test-setup.ts` 导入路径错误） | 初版实测 `12 failed (12), Tests no tests` | 已修正；CI `npm test` 13 个文件全部通过 |
| R12 | 中 | 分支构建不产出 Release，只能下载 14 天有效的 artifact | 6.4；`desktop.yml` 的 Release 步骤限定 `main`/tag | 合并到 `main` 或打 tag 后回填 `{{RELEASE_URL}}` |
| R13 | 中 | 五项人工/真机验收尚未进行（同跑、U 盘、缩放、语言与托盘观感、同机共存） | 6.5 的 U1–U6 | 合并前至少完成 U1、U6；余项写进发布说明 |
| R14 | 低 | native-smoke 的临时目录清理降级为 best effort；WebView2 子进程会短暂持有 `EBWebView` 日志文件 | 失败 run #43903556973；`ignore_cleanup_errors=True` | 可在 smoke 结束前显式等待子进程退出；当前由 runner 回收，不影响判定 |
| R15 | 信息 | 本报告的中文本地化数字仍是初版快照，CI 未包含 i18n 审计步骤 | 第 2 节补充说明 | 建议把 `i18n-coverage-audit.mjs` 加进 workflow 并设 0 硬编码门禁 |

---

## 8. 用户本机最终验证

CI 已覆盖“构建 + 自动化测试 + 便携运行期断言”（第 6 节），本机只需补 6.5 中的人工/真机项。
步骤见 `docs/cn-portable/06-local-verification-steps.md`，包含：

- 自动化脚本命令（`portable-acceptance.py`，含 `--launch`）；
- 数据路径与移动文件夹验证；
- Codex 日志哈希/重命名/Process Explorer 句柄检查；
- Cockpit 同跑 5–10 分钟观察法（T0/T1/T2、CPU/内存/磁盘采样、判定阈值）——对应 U1；
- 凭据管理器与卸载残留检查；
- 外接移动硬盘/U 盘运行（U2）、显示缩放走查（U3）、中英切换与托盘/通知观感（U4/U5）、
  与官方版同机共存（U6）；
- 可直接回填的汇总表。

---

## 9. 证据与复核

本报告引用的所有脚本均可独立重跑：

```bash
node desktop/scripts/i18n-coverage-audit.mjs
python -m py_compile desktop/scripts/portable-acceptance.py
python desktop/scripts/portable-acceptance.py <便携目录或ZIP> [--launch]
python desktop/scripts/portable-verify.py dist/Tokrate-CN-Portable-win-x64.zip   # CI 已跑 7/7
python desktop/scripts/native-smoke.py <exe>                                    # CI 已跑
cd desktop/core && cargo test --test cockpit_contention -- --nocapture   # 需 Rust 工具链
```

**报告可信度声明：** 本文中的“已验证通过”分两类，均标注了来源：①在本机可复现的静态检查/脚本运行；
②GitHub Actions 成功 run #43905944040 的日志与产物（`09f5aeb`）。凡是需要人工目视、真机外设、
真实 Cockpit 或同机共存的项目，一律标注为“未验证”（6.5 / 第 7 节），没有推定通过；
分支构建未产出 Release，故不给出可用的 Release 链接，仅保留占位 `{{RELEASE_URL}}`。

---

## 10. 附录：执行记录

### 10.1 初版本地验收（快照 `d9955c7`，2026-11-16）

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `git branch --show-current` / `git log -1` | `tokrate-cn` / `d9955c7` | 当时改动未提交 |
| `node desktop/scripts/i18n-coverage-audit.mjs` | 退出码 0；39 处 / 10 文件（23:20） | 数值在验收期间持续下降（160 → 49 → 39）；本版未重跑 |
| `python -m py_compile desktop/scripts/portable-acceptance.py` | 通过 | 无语法错误 |
| `python desktop/scripts/portable-acceptance.py <合成目录>` | 6 通过 / 1 失败 / 5 跳过 | 失败项为“中文本地化”启发式检查（合成 exe 无中文），符合预期 |
| `python desktop/scripts/portable-acceptance.py <仓库 desktop 目录>` | 2 通过 / 2 失败 / 8 跳过 | 无 exe，失败项为“包结构/数据目录”，符合预期 |
| `cd desktop && npx vitest run` | 当时 12 个测试文件全部失败、0 用例执行 | `test-setup.ts` 导入路径错误（R11，已在 CI 修复） |
| `cargo test` / `tauri build` | 当时未执行 | 本机没有可用 Rust 工具链/Windows 构建链 |

> 说明：本机执行验收脚本时，沙箱拦截了 `reg.exe`，因此第 12 项按设计降级为“跳过”并提示手动检查；
> 脚本已在代码上区分“无匹配”与“查询失败”，不会把查询失败误报为通过。

### 10.2 CI 实跑（head `09f5aeb`，2026-11-17）

| run | 步骤 | 结果 | 说明 |
| --- | --- | --- | --- |
| `43903153446` | `Set up job` | **失败** | action SHA 无法解析（详见 6.3） |
| `43903556973` | 测试 / smoke / 便携验证 | 断言全通过，但脚本退出失败 | `TemporaryDirectory` 清理 `PermissionError [Win32]`（详见 6.3） |
| `43905944040` | 全流程 | **success** | 前端 13 文件通过；core 403 passed；`cockpit_contention` 10 passed；Tauri 129 passed / 1 ignored；smoke 四项 true；便携验证 7/7；产物 sha256 已记录 |
