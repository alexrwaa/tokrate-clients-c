# 03 · 验收报告（Tokrate-CN Portable）

- 验收对象：`tokrate-cn` 分支工作区（Fork：alexrwaa/tokrate-clients-c）
- 代码基线：HEAD `d9955c7` + 2026-11-16 并行开发中的**未提交改动**
- 验收人：Agent D（独立测试与质量）
- 验收方式：只读代码审查 + 脚本自检 + 现有证据核对
- **本报告不包含任何未实际产生的构建/CI/真机结果**；没有证据的项目一律标注“未验证”

---

## 0. 一句话结论

**尚未达到发布标准。** 便携化（数据目录、WebView2 重定向、打包与 CI 定义）已完成代码级实现，
中文本地化在验收期间从 160 处硬编码快速降到 39 处（B 仍在迁移），但尚未清零；
且**没有任何一次真实构建/CI/真机运行证据**，性能与 Cockpit 同跑必须由用户本机确认。
当前状态适合“内部验收”，不适合对外发布。

| 维度 | 状态 |
| --- | --- |
| 便携数据布局 | 已实现，**未运行验证** |
| 打包与 CI | 脚本齐全，**未执行，待 CI 回填** |
| 中文本地化 | **未通过**（验收时刻 39 处硬编码，10 个文件；仍在下降） |
| 语言切换 | 已实现（设置页），切换后的全局刷新未运行验证 |
| Codex 目录识别 | 代码正确，本机目录存在；程序行为未运行验证 |
| Cockpit 兼容 | 分析完成；一处读取优化已改但未编译验证；真机未测 |
| 性能 | **待 CI / 本机实测** |
| 安全与隐私 | 代码级审查通过，2 项需处理（凭据残留、同意页未汉化） |

---

## 1. 开发完成情况表

状态定义：**已验证通过**（有可复现证据）/ **部分通过**（实现存在但缺关键环节）/ **未验证**（有实现但未运行/未测量）/ **失败**（实测不满足）。

| # | 验收项 | 状态 | 证据来源 |
| --- | --- | --- | --- |
| 1 | 仓库与分支就绪（`tokrate-cn`） | 已验证通过 | `git branch --show-current` → `tokrate-cn`；HEAD `d9955c7` |
| 2 | 便携数据目录 `<exe>/data`，无 C 盘回退 | 部分通过 | `desktop/src-tauri/src/portable.rs:47-79`（解析 exe 目录、创建 data/cache/logs/webview、写探针）；`main.rs:291-303` 失败即退出。**未运行验证** |
| 3 | WebView2 配置写入 `data/webview` | 部分通过 | `portable.rs:26,94-98` 设置 `WEBVIEW2_USER_DATA_FOLDER`；由 C 的 `portable-verify.py` 设计为运行期断言，**未执行** |
| 4 | 不写 `%LOCALAPPDATA%` / `%APPDATA%` | 未验证 | 代码路径已改（`main.rs:357` 使用 `data.root()`）；需 `portable-verify.py` 或本机 06 §3 实测 |
| 5 | 便携 ZIP 打包（exe + 空 data/ + 中文 README） | 部分通过 | `desktop/scripts/package-portable.mjs` 已实现自写 ZIP、SHA-256、manifest；**未运行**（本机无 release exe） |
| 6 | CI 构建 Windows x64 便携包 | 未验证 | `.github/workflows/desktop.yml` 已定义；`package-portable.mjs`、`portable-verify.py` 已存在；**无任何运行记录**（见第 6 节） |
| 7 | 中文本地化（界面） | **未通过** | `node desktop/scripts/i18n-coverage-audit.mjs` → 验收时刻 39 处硬编码 / 10 个文件（数值随 B 迁移持续下降）；详见 02 |
| 8 | 语言切换入口 | 部分通过 | `Settings.tsx:123-137,206` 已提供中/英切换与 `setLanguage`；切换后各页面即时刷新未运行验证 |
| 9 | Rust 侧可见文案汉化 | 部分通过 | 托盘菜单/提示/对话框标题已中文（`main.rs`、`flyout.rs`）；运行时状态仍英文（`runtime.rs:689,755,841,1454`） |
| 10 | Codex 会话目录识别（`CODEX_HOME` / `~/.codex/sessions`） | 部分通过 | `runtime.rs:112-114,141`；本机 `C:\Users\Admin\.codex\sessions` 存在。**程序是否自动识别未运行验证** |
| 11 | 多数据源检测与手动指定 | 部分通过 | `sources.rs`、`main.rs:choose_folder`；本机仅检测到 Codex，其他源不可测 |
| 12 | 监测开关 | 部分通过 | `runtime.rs:809` 暂停 poll；但 `watch_targets()` 未检查开关，暂停后 watcher 仍持有句柄（01 §3.2，**补丁未应用**） |
| 13 | 与官方版共存 | 未验证 | 标识已改为 `dev.tokrate.cn.portable`（`tauri.conf.json:5`），数据独立；单实例互斥与同时运行未实测。keyring 服务名未改，见风险 R2 |
| 14 | 不写 Codex 凭证/配置 | 部分通过 | 只读打开（`reader.rs:46`），无 `auth.json` 生产代码；需 `--launch` 对比验证（未执行） |
| 15 | 普通用户权限 | 部分通过 | 无 `requireAdministrator`；`tauri.conf.json:38` 安装器为 currentUser（便携包不含安装器）。未在普通账户实测 |
| 16 | 卸载 = 删除文件夹 | 部分通过 | 无卸载注册表项；但 Windows 凭据管理器条目会残留（05 §3.1） |
| 17 | Cockpit 兼容性分析 | 已验证（分析） | `docs/cn-portable/01-cockpit-perf.md`；代码级结论完整，真机未测 |
| 18 | 读取路径重复 open 修复 | 部分通过 | `desktop/core/src/reader.rs` 已改（+30/−23）；**未编译、未跑测试**（A 报告无 Rust 工具链） |
| 19 | 性能数据 | 未验证 | 无任何实测数字；`cargo test --test cockpit_contention` 未运行 |
| 20 | 本地验收脚本 | 已验证通过 | `desktop/scripts/portable-acceptance.py`：`py_compile` 通过，在真实目录上跑通 12 项（2 通过 / 2 失败 / 8 跳过，失败项因该目录无 exe，符合预期） |
| 21 | 汉化审计脚本 | 已验证通过 | `node desktop/scripts/i18n-coverage-audit.mjs` 正常输出，退出码 0 |
| 22 | 安全审查 | 已验证通过 | `docs/cn-portable/05-security-review.md`，结论均有 `文件:行号` |
| 23 | 用户文档与本机验收步骤 | 已验证通过 | `04-user-guide-zh.md`、`06-local-verification-steps.md` |
| 24 | 前端单元测试回归 | **失败** | `cd desktop && npx vitest run` → **12 个测试文件全部 collect 失败，0 个用例执行**；根因：`desktop/ui/test-setup.ts:1` 导入 `./ui/i18n`（应为 `./i18n`）。已通知 B，未修复（不在 D 的文件范围） |

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

---

## 3. Cockpit 兼容性

### 3.1 结论摘要（引用 01，不复制其推测）

01 文档的代码级结论：

1. 读取有硬上限：每轮 poll 最多 1 MiB 内容、最小间隔 2 s（`sources.rs:18`、`schedule.rs:10`）；
2. 对源目录**不写、不改名、不删除**，且不使用 `share_mode`/`flock`/`LockFileEx`，Windows 默认共享模式不会阻止 Cockpit 打开同一文件；
3. “Tokrate 的进程内锁导致 Cockpit 卡死”不成立（跨进程无效）；真正可能放大的是首次全量回放、目录枚举与每次 open 的杀软过滤开销；
4. 上述量级均属 **B 级（机制可证、数值需实测）**，不能当作已验证性能结论。

### 3.2 已修复项

- **每个 reader 每轮重复 `open` 同一文件** → 改为单次 open、同一句柄完成 stat/seek/read：
  `desktop/core/src/reader.rs`（+30/−23，`read_at` 改为接收 `&mut File`，`poll_records` 只 open 一次）。
- 副作用修正：消除了“按旧 size 读新文件”的竞态。
- 新增压力测试 `desktop/core/tests/cockpit_contention.rs`（9 个断言），**但未运行**。

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

**没有任何实测数据。** 01 文档中的数值全部是上限推算或“待测”，本报告不转写为结论。

| 指标 | 状态 | 获取方式 |
| --- | --- | --- |
| 每轮读取字节 / open 次数 | 待 CI 实测 | `cargo test --test cockpit_contention -- --nocapture` |
| 100 / 1000 / 10000 文件的首轮与最慢轮耗时 | 待 CI 实测 | 同上，`[scale]` 输出 |
| 空闲 CPU / 内存 / 磁盘 | 待本机实测 | 06 §5.3 |
| Cockpit 账号切换延迟 T0/T1/T2 | 待本机实测 | 06 §5.1–5.2 |
| 首次全量回放时长 | 待本机实测 | 清空 `data/` 后启动观察 |

> reader.rs 的改动尚未编译；在 CI 跑通 `cargo test` 之前，不能声称“性能已优化”。

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

> **待 CI 回填。** 截至本报告时间，工作区改动未提交、未推送，因此没有任何 workflow 运行记录。

| 项目 | 状态 | 回填内容 |
| --- | --- | --- |
| workflow 文件 | 已存在 | `.github/workflows/desktop.yml`（Windows x64，`npm test` → `cargo test` → `tauri build --no-bundle` → 打包 → 校验 → 上传/发布） |
| 构建成功/失败 | **待 CI 回填** | run 链接、job 结论 |
| 产物下载链接 | **待 CI 回填** | `Tokrate-CN-Portable-win-x64.zip`（artifact 或 `cn-portable-latest` release） |
| ZIP SHA-256 | **待 CI 回填** | `.zip.sha256` 内容 |
| exe SHA-256 | **待 CI 回填** | workflow `Verify release executable` 步骤输出 |
| 测试结果（前端/Core/桌面 crate） | **待 CI 回填** | `npm test`、`cargo test` 日志（`ci-artifacts` 分支） |

已知风险：workflow 当前引用的 `package-portable.mjs`、`portable-verify.py` 已由 C 补齐，
但**未经过一次真实运行**；首次运行可能暴露路径/产物名不一致，属正常调试范围。

---

## 7. 未解决问题与风险

| ID | 严重度 | 问题 | 证据 | 建议 |
| --- | --- | --- | --- | --- |
| R1 | 高 | 中文本地化未清零，共享同意页仍英文 | 02 全文；脚本输出 39 处（验收时刻） | B 完成剩余 10 个文件；同意页优先；发布门禁设为 0 硬编码 |
| R2 | 中 | 删除文件夹后凭据管理器残留，且与官方版共用身份 | `runtime.rs:1219`；05 §3.1 | 改用独立服务名；文档已写清理方法 |
| R3 | 低 | 语言切换已实现，但切换后的全局刷新未验证 | `Settings.tsx:123-137` | 本机切换一次并走查各页面（06 可补一项） |
| R4 | 中 | 暂停监测后 watcher 未释放 | 01 §3.2；`runtime.rs:784` 未改 | 应用 01 的 8 行 patch 并跑回归 |
| R5 | 中 | reader.rs 改动未编译/未跑测试 | A 报告“无 Rust 工具链” | CI 必须先跑 `cargo test -p tokrate-core` |
| R6 | 中 | 无任何构建/CI/真机证据 | 本报告第 6 节 | 推送后触发 workflow，回填数据 |
| R7 | 低 | 运行时状态文案仍英文 | `runtime.rs:689,755,841,1454` | 与 B 统一迁移到字典 |
| R8 | 低 | `data/` ACL 继承父目录 | `private_file.rs` Windows 分支 | 文档提示放个人目录；可选 ACL 加固 |
| R9 | 低 | 便携版 UI 仍有“检查更新”入口但更新器不可用 | `main.rs:326`、`updater_state.rs:221` | 便携模式隐藏更新区或显示“便携版不自动更新” |
| R10 | 信息 | `data/logs/` 为空目录，文档需说明 | `portable.rs:69` | 已在 04 文档注明“可能为空” |
| R11 | **阻断** | 前端测试 12/12 文件无法加载（`test-setup.ts` 导入路径错误） | `desktop/ui/test-setup.ts:1`；实测 `npx vitest run` → `12 failed (12), Tests no tests` | 改为 `./i18n`；已通知 B；修好后 CI 的 `npm test` 才可能通过 |

---

## 8. 用户本机最终验证

见 `docs/cn-portable/06-local-verification-steps.md`，包含：

- 自动化脚本命令（`portable-acceptance.py`，含 `--launch`）；
- 数据路径与移动文件夹验证；
- Codex 日志哈希/重命名/Process Explorer 句柄检查；
- Cockpit 同跑 5–10 分钟观察法（T0/T1/T2、CPU/内存/磁盘采样、判定阈值）；
- 凭据管理器与卸载残留检查；
- 可直接回填的汇总表。

---

## 9. 证据与复核

本报告引用的所有脚本均可独立重跑：

```bash
node desktop/scripts/i18n-coverage-audit.mjs
python -m py_compile desktop/scripts/portable-acceptance.py
python desktop/scripts/portable-acceptance.py <便携目录或ZIP> [--launch]
cd desktop/core && cargo test --test cockpit_contention -- --nocapture   # 需 Rust 工具链
```

**报告可信度声明：** 本文中的“已验证通过”仅指在本机可复现的静态检查/脚本运行；
凡是需要 GUI、Windows 运行时、Cockpit 或 CI 的项目，均明确标注为“未验证/待回填”，没有推定通过。

---

## 10. 附录：本次实际执行记录

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `git branch --show-current` / `git log -1` | `tokrate-cn` / `d9955c7` | 分支正确；改动全部未提交 |
| `node desktop/scripts/i18n-coverage-audit.mjs` | 退出码 0；39 处 / 10 文件（23:20） | 数值在验收期间持续下降（160 → 49 → 39） |
| `python -m py_compile desktop/scripts/portable-acceptance.py` | 通过 | 无语法错误 |
| `python desktop/scripts/portable-acceptance.py <合成目录>` | 6 通过 / 1 失败 / 5 跳过 | 失败项为“中文本地化”启发式检查（合成 exe 无中文），符合预期 |
| `python desktop/scripts/portable-acceptance.py <仓库 desktop 目录>` | 2 通过 / 2 失败 / 8 跳过 | 无 exe，失败项为“包结构/数据目录”，符合预期 |
| `cd desktop && npx vitest run` | **12 个测试文件全部失败、0 用例执行** | `test-setup.ts` 导入路径错误（R11） |
| `cargo test` / `tauri build` | **未执行** | 当前环境没有可用 Rust 工具链/Windows 构建链 |
| GitHub Actions | **未运行** | 改动未推送；无 run 记录 |

> 说明：本机执行验收脚本时，沙箱拦截了 `reg.exe`，因此第 12 项按设计降级为“跳过”并提示手动检查；
> 脚本已在代码上区分“无匹配”与“查询失败”，不会把查询失败误报为通过。
