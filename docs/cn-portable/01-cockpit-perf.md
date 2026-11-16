# Cockpit Tools 卡顿排查：Tokrate 的监视链路与资源包络

> 适用：Tokrate-CN Portable（Windows 桌面版，Tauri 2 + `desktop/core`）在**同一台机器上同时运行 Cockpit Tools** 时，用户报告「Tokrate 启动后 Cockpit Tools 卡顿/无响应」。
>
> 本文只回答三件事：Tokrate 到底做了什么、这些动作对**其他进程**最多能造成多大影响、哪些结论必须在本机同跑才能确认。
>
> 证据分级：
> - **A（代码可证）**：可以由源码常量、控制流与已落库的压力测试证明。
> - **B（推理，需本机测量数值）**：机制确定，量级需要在目标机器上用 Procmon / 任务管理器 / `cargo test --nocapture` 取值。
> - **C（本机 + 真实 Cockpit 同跑才可确认）**：涉及 Windows 内核过滤驱动、第三方进程实现，云上/CI 不等价。

## 0. 结论摘要

1. **Tokrate 的读取量是硬上限的**：整机每轮 poll 最多读 **1 MiB 内容**（`desktop/core/src/sources.rs:18` `TOTAL_POLL_BUDGET`，`sources.rs:642` 越界即报错），且轮询最小间隔 **2 s**（`desktop/src-tauri/src/schedule.rs:10`）。即持续回放时内容读约 **512 KiB/s**，不是「无上限地扫目录」。
2. **Tokrate 从不对源目录写入、改名、删除，也不加任何文件锁**（`desktop/core/src`、`desktop/src-tauri/src` 内无 `flock`/`LockFileEx`/`share_mode` 调用）。Windows 上 Rust `std` 默认共享模式为 `FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE`，**Tokrate 的 open 不会让 Cockpit 的 open 失败**。
3. 因此「Tokrate 的进程内锁把 Cockpit 卡死」这类说法不成立：两个进程在不同地址空间，`Mutex` 只能影响 Tokrate 自己的线程。能跨进程生效的只有**系统资源竞争**：磁盘 I/O、CPU、目录/文件句柄、以及杀毒软件对 open 的放大。
4. 真正值得盯的放大点（按影响排序）：
   - **首次启动/换机后的全量回放**：最多 2000 个文件 × 每个文件从 0 重放，按 1 MiB / 2 s 的节流慢慢读，可持续数十分钟到数小时（**B**）。
   - **每个会话文件的新建都触发一次全量目录枚举**（`monitor.rs:539` → `needs_discovery` → `discover_files`），单次最多 10 万目录项（**A**，见 §3.4）。
   - **Windows 空闲文件探测**：每 5 分钟最多 2000 次额外 `open`/monitor（Claude 双 monitor 合计 4000 次）（**A**，见 §3.4）。
   - **每个 reader 每轮打开文件两次**（已修复为一次，见 §3.1）。
5. 本次**唯一改动的代码**是读取路径的重复 `open`（§3.1）；另外两处根因在 `runtime.rs`（§3.2、§3.3），按要求只给精确 patch、未落改；其余是记录在案的设计性放大（§3.4）。

## 1. 监视链路机制清单

| 机制 | 常量 / 位置 | 行为 | 上界 |
| --- | --- | --- | --- |
| 目录监视 | `desktop/src-tauri/src/watcher.rs:248` `Active::start`、`watcher.rs:299` `Watchers::sync` | 每个已存在的源根一个 `notify` watcher；Codex/Claude/Kimi/Grok 递归，Antigravity/OpenCode/T3 只监视直接子项（`sources.rs:818` `watch_folders`） | 约 9 个 watcher 句柄；Windows 用一棵子树一个 `ReadDirectoryChangesW` 句柄，Linux 为每目录一个 inotify watch |
| 事件合并 | `watcher.rs:25` `COALESCE_WINDOW = 500 ms`、`watcher.rs:194` `coalesce` | 一次突发事件合并成一个 `SourceChange`，500 ms 窗口结束才投递 | 每 500 ms 最多投递一次 |
| 事件积压保护 | `schedule.rs:20` `MAX_PENDING_PATHS = 4096`、`watcher.rs:183`、`schedule.rs:128` | 待处理路径超过 4096 条即丢弃路径、降级为「全量重扫」 | 无界涨不了：最坏变成一次枚举 |
| 轮询节拍 | `schedule.rs:10` `MIN_POLL_SPACING = 2 s`、`schedule.rs:13` `IDLE_POLL_INTERVAL = 30 s`、`schedule.rs:30` `poll_delay` | 有积压时最快 2 s 一轮，安静时 30 s 一轮 | 2 s / 30 s |
| 总读取预算 | `sources.rs:18` `TOTAL_POLL_BUDGET = 1 048 576`、`sources.rs:571` `poll`、`sources.rs:642` | 每轮所有源合计读取内容不超过 1 MiB，超出直接报错 | **1 MiB / 轮** |
| 分源预算 | `sources.rs:19` Codex 288 KiB；`sources.rs:23-27` Claude 288 KiB（子代理 72 KiB）；`sources.rs:30-32` Kimi 每 home 64 KiB；`sources.rs:35` Antigravity 128 KiB；`sources.rs:36` OpenCode 64 KiB；`sources.rs:37-42` Grok 128 KiB | 单个源再快也吃不掉别人的份额 | 见左 |
| 每批读取 | `monitor.rs:24` `READER_BATCH_BYTES = 64 KiB`、`monitor.rs:27` `MAX_READERS_PER_LANE = 24` | 每轮、每条 lane 最多 24 个 reader，每个最多 64 KiB | ≤ 1.5 MiB，再被预算压到 ≤ 1 MiB |
| 最近尾部 | `monitor.rs:39` `RECENT_TAIL_BYTES = 256 KiB`、`reader.rs:369` `prepare_recent_tail` | 新文件只读末尾 256 KiB 做实时统计 | 256 KiB / 文件 |
| 历史回放 | `monitor.rs:815`（`candidate.size > RECENT_TAIL_BYTES` 时建 `archive`）、`monitor.rs:408-469` | 大于 256 KiB 的新文件额外建一个「从 0 开始」的 reader，按 64 KiB/轮 慢慢读完整文件 | 文件大小，但被总预算节流 |
| 增量游标 | `reader.rs:301` `poll_records`、`reader.rs:497` `reset_for_current_file` | 每文件保存 `offset`；文件变小或 identity 变化即重置 | 每次只读增量 |
| checkpoint | `monitor.rs:634` `checkpoints`、`monitor.rs:704` `matching_checkpoint`、`reader.rs:523` `checkpoint_offset` | 只对「已读完 + 已定位 + 无挂起解析」的文件记 offset；启动时仅当文件静置 ≥ 600 s（`monitor.rs:37`）才信任 | 每源 2000 条（`monitor.rs:25` `MAX_FILES`） |
| 文件数上限 | `monitor.rs:25` `MAX_FILES = 2000`、`monitor.rs:775/834` | 每个 monitor 只跟踪最近修改的 2000 个文件 | 2000 / monitor |
| 枚举上限 | `monitor.rs:26` `MAX_DISCOVERED_PATHS = 100 000`、`monitor.rs:30` `DISCOVERY_INTERVAL_SECONDS = 300` | 每 300 s 或 watcher 要求时全量枚举一次；单次最多 10 万目录项 | 10 万条目 / 300 s / monitor |

## 2. 资源行为推算（B：机制可证，数值需本机取）

### 2.1 内容读（磁盘字节）

- 硬上限：`1 048 576 B / 2 s ≈ 512 KiB/s`（仅当总有积压时持续达到；空闲时是 30 s 一轮且通常 0 字节——watcher 没报告的文件根本不会 open，`monitor.rs:511` `select_live_keys`）。
- 全量回放的最坏体量：2000 文件/monitor × 每 monitor 独立预算。假设 Claude 项目目录有 2000 个 1 MB 的 jsonl，回放需要读约 2 GB，按 512 KiB/s 约 **1.1 小时**（**B**：实际取决于文件大小与是否已有 checkpoint）。
- 结论：Tokrate 是「低带宽、长时间」的读者，不是「瞬时抢占磁盘」的读者。对 Cockpit 的影响更可能是**持续的小 I/O + 每次 open 的过滤驱动开销**，而不是带宽打满。

### 2.2 文件 open 次数（Windows 上每次 open 都是一次完整路径解析 + 杀软过滤）

- 每轮最多 24 个 live reader + 24 个 archive reader（`monitor.rs:356`、`monitor.rs:415`）。
- 修复前：每个 reader 每轮 **2 次 open**（`reader.rs` 旧代码先 open 取 size/identity，再 open 读）；对齐阶段 3 次。
- 修复后：**1 次**（见 §3.1）。
- 即最坏情况下 2 s 内 96 次 open（修复前）→ 48 次（修复后），折合 **48/s → 24/s**。

### 2.3 目录枚举

- 默认布局下同时跑的递归枚举：Codex（每个 profile 一个 root）、Claude primary + Claude subagents（**同一棵树枚举两遍**）、Kimi CLI primary/sub + Kimi Desktop primary/sub（**每个 home 两遍**）→ 至少 7 个根。
- 每 300 s 一轮；若某个根顶到 10 万条目，最坏是 70 万目录项 / 300 s ≈ **2300 条目/s**（全部是元数据，只有 `.jsonl` 才 `metadata()`）。
- 额外的触发点：**每出现一个此前未跟踪的会话文件，都会把下一轮变成全量枚举**（`monitor.rs:549-552`）。Claude Code 频繁产生 subagent transcript 时，这是最容易观察到的「扫目录」来源。

### 2.4 Windows 空闲文件探测

`monitor.rs:111` `refresh_idle_candidates_from_open_handles`（仅 Windows）在每次发现阶段对「已跟踪、已追平、大小/时间都没变」的文件逐个再 open 一次，用来绕过 NTFS 目录项元数据陈旧。上界 = 每个 monitor 2000 次 / 300 s；Claude 两个 monitor 合计 **4000 次 / 5 min ≈ 13 open/s**。

### 2.5 句柄与线程

- 目录监视句柄：约 9 个（Windows 为每个递归根一个）。
- 每个 watcher 一个 `tokrate-watch` 合并线程（`watcher.rs:267`），约 9 个线程。
- 文件句柄：短生命周期，每次 open 读完即关（`reader.rs:74` `read_at` 使用的是同一句柄，读完释放）。
- 不持有任何跨进程排他锁；不写入、不改名、不删除源文件。

## 3. 发现的问题与处理

### 3.1 已修复：每个 reader 每轮把同一个文件 open 两次

**证据（A）** `desktop/core/src/reader.rs`（修复前）：

```rust
// poll_records(): 为了绕过 Windows 目录项元数据陈旧，改用「打开句柄取 size」
let (_, metadata) = open_regular_file(&self.path)?;   // open #1，取完立刻 drop
...
let bytes = self.read_at(self.offset, count)?;        // read_at 内部又 open #2
...
// Alignment 阶段还有 open #3
let (mut file, _) = open_regular_file(&self.path)?;
```

同一 crate 里的 Grok 读取器（`desktop/core/src/grok.rs:149`）就是「open 一次、用同一句柄 stat + seek + read」的写法，说明这是 `IncrementalReader` 的疏漏，而不是有意的语义。

**修复**：把 `read_at` 改成接收 `&mut File` 的自由函数（`reader.rs:74`），`poll_records` 只 open 一次（`reader.rs:309`）并把句柄一路传给 `prepare_recent_tail`（`reader.rs:369`）与对齐阶段。

**顺带修正的语义**：以前 size/identity 来自 open #1、字节来自 open #2，两次 open 之间文件可能被替换，导致「按旧文件的大小去读新文件」；现在读的一定是被 stat 的同一个文件。

**代价**：句柄多持有几十微秒（读完即 drop），无。

### 3.2 未改（根因在 `runtime.rs`）：暂停监测后 watcher 仍在跑

**证据（A）**：`runtime.rs:784` `watch_targets()` 不检查 `settings.monitoring`；`runtime.rs:809` 只是跳过 `monitor.poll`。于是「Monitoring paused」时：约 9 个目录监视句柄、9 个合并线程、每 500 ms 的事件合并、以及每 30 s 一轮的空转 poll 全部保留。用户的语义预期是「暂停 = 不再碰那些目录」。

**Patch（2 个文件，共 8 行）**

1. `desktop/src-tauri/src/runtime.rs:784`（在函数第一行插入 4 行）：

```rust
 pub fn watch_targets(&self) -> Vec<WatchTarget> {
+    // 暂停监测时不持有任何目录监视：watcher 会随空目标列表被丢弃，恢复时由下一轮 sync 重建。
+    if !self.settings.monitoring {
+        return Vec::new();
+    }
     CODING_TOOLS
```

2. `desktop/src-tauri/src/watcher.rs:299`（`sync` 开头插入 3 行，并让 `HashSet` 进入 `use`）：

```rust
+use std::collections::{HashMap, HashSet};   // watcher.rs:11，原为 {HashMap}
...
 pub fn sync(&mut self, targets: &[WatchTarget], signal: &Arc<PollSignal>) {
+    // 不在本轮目标里的源（暂停监测、源被移除）要连 watcher 一起丢掉：
+    // watcher 一旦 drop，coalesce 线程会因为通道断开而退出。
+    let wanted: HashSet<&'static str> = targets.iter().map(|target| target.source).collect();
+    self.active.retain(|source, _| wanted.contains(source));
+    self.failed.retain(|source, _| wanted.contains(source));
     for target in targets {
```

安全性：`watch_folders` 对每个已知源返回的名字集合是稳定的（`sources.rs:818-879`，Antigravity 恒返 3 个目录名 + 可选 t3），所以不会出现「每轮拆掉再重建」的抖动；恢复监测时 `sync` 在每轮 poll 前调用（`runtime.rs:1265`），watcher 会被重新建立。

### 3.3 未改（需要重构 `runtime.rs`）：Runtime 互斥锁覆盖整个 poll

**证据（A，但只影响 Tokrate 自身 UI）**：`runtime.rs:1273-1275`

```rust
let mut runtime = shared.lock().unwrap();   // std::sync::Mutex<Runtime>
let polled = runtime.poll_monitor();        // 里面含 1 MiB 读 + 解析 + 目录枚举 + 逐源 stat
(polled, runtime.show_provider_badge())
```

`poll_monitor` → `poll_monitor_at`（`runtime.rs:801`）→ `self.monitor.poll(now)`（`runtime.rs:810`）整段都在锁内；同时前端每 5 s 拉一次 `snapshot`（`desktop/ui/store/store.ts:25` `POLL_MS = 5000`）也要这把锁。**这只让 Tokrate 自己的 flyout 卡顿，不可能影响 Cockpit**，但如果用户是「先看到 Tokrate 卡，再觉得 Cockpit 卡」，这是唯一的进程内解释。

**Patch 要点**（`Runtime.monitor: SourceMonitor` → `Option<SourceMonitor>`，共 10 处机械改动，全部在 `runtime.rs`）：

- `runtime.rs:229`：`monitor: Option<SourceMonitor>`；
- `736/740`（`set_root`）、`780`（`absorb_signal`）、`787`（`watch_targets`）、`810/815/820/826`（`poll_monitor_at`）、`872`（`next_poll_deadline`）、`939`（`fresh_checkpoints`）改成 `self.monitor.as_mut()` / `as_ref()`；
- `runtime.rs:1256-1277` 改成「短暂持锁取配置 → 释放锁做 I/O → 再短暂持锁 ingest」：

```rust
 let result = {
     let (shared, watchers, signal) = (shared.clone(), watchers.clone(), signal.clone());
     tauri::async_runtime::spawn_blocking(move || {
         let targets = shared.lock().unwrap().watch_targets();
         { /* watchers.sync，不持锁 */ }
+        let (mut monitor, now) = {
+            let mut runtime = shared.lock().unwrap();
+            (runtime.monitor.take(), Utc::now())
+        };
+        // 读盘与解析完全不持 Runtime 锁：UI 的 snapshot 不会被一轮 poll 挡住。
+        let polled_sources = monitor.as_mut().map(|monitor| poll_sources(monitor, now));
+        let mut runtime = shared.lock().unwrap();
+        runtime.monitor = monitor;
+        let polled = runtime.ingest_polled(polled_sources, now);
+        (polled, runtime.show_provider_badge())
     }).await
 };
```

需要主智能体把 `poll_monitor_at` 拆成「无锁的 `poll_sources(&mut SourceMonitor, now)`」和「持锁的 `ingest`」，并在能编译的环境跑 `cargo test -p tokrate --lib`（runtime.rs 自带测试）。

### 3.4 记录在案、本次不动的设计性放大

1. **每个新文件触发一次全量枚举**（`monitor.rs:549`）：`note_changes` 对「尚未跟踪但符合格式」的路径置 `needs_discovery`。改成「直接读这一个文件」需要在 `note_changes` 里复制 `discover_files` 的插入逻辑（含 checkpoint 匹配、MAX_FILES 容量、identity/size 初值），风险高于收益，且本仓库无法本地编译，故不动。
2. **Claude / Kimi 各有两个 monitor 走同一棵树**（`sources.rs:124-142`）：primary 与 subagents 过滤的是不同文件（不会重复读同一个文件），但**目录会被枚举两遍**。合并成一次枚举需要把「发现」与「格式过滤」拆开，属于结构调整。
3. **`MAX_FILES = 2000` 边界抖动**（`monitor.rs:775`、`monitor.rs:834`）：文件数超过 2000 且不断有滑动写入时，掉出窗口的文件再次进入会重新建 reader（可能再读一次 256 KiB 尾部）。总量仍被 1 MiB/轮 限制。
4. **checkpoint 恢复后的首轮会重读一次头部**（`reader.rs:369`，最多 64 KiB）：为拿回 parser 上下文，属于设计取舍；`tests/cockpit_contention.rs` 的断言把它固定为「≤ 文件大小一次」。
5. **小文件首次发现会读两遍**（`reader.rs:369` `prepare_recent_tail`）：找头部的那一次按 `max_bytes`（≤ 64 KiB）整段读入 `pending`，随后 `pending.clear()` 并回退到 `header_end`，正文在下一轮再读一遍。≤ 64 KiB 的文件因此首轮是 2 倍读取，64 KiB–256 KiB 的文件是 1.x 倍。修它需要让 `prepare_recent_tail` 把已读到的正文交回解析器（改变返回类型与 `begin_mid_file` 时序），风险高于收益，本次不动；测试里用 `2 * 文件总字节` 作为首轮上界把它固定住。
6. **`archive` 全量重放**（`monitor.rs:815`）：大于 256 KiB 的文件从头再读一遍（去重靠 record id），这是回放准确性的代价。
7. **Windows 空闲探测的 2000 次 open/5 min**（`monitor.rs:111`）：这是上游为绕过 NTFS 元数据陈旧做的补偿；删掉会导致「另一个进程还开着写句柄时统计延迟」，只能改成带游标的轮转（需要新状态），本次不动。

### 3.5 已排除的猜想（附反证）

| 猜想 | 反证 |
| --- | --- |
| 「Tokrate 的锁把 Cockpit 卡死」 | 不同进程、不同地址空间；`Mutex` 只作用于本进程线程。跨进程只能通过内核对象（文件锁、命名互斥体、共享内存）生效，而本仓库没有任何这类调用（全仓 `grep flock/LockFileEx/share_mode` 为空）。 |
| 「Tokrate 锁住了日志文件导致 Cockpit 读不到」 | Tokrate 对源文件只读、只 open，不使用 `share_mode`，即 `std` 默认 `FILE_SHARE_READ|WRITE|DELETE`；`tests/cockpit_contention.rs::opening_a_file_another_reader_holds_still_succeeds` 把这条共享语义固定住。 |
| 「Tokrate 在无限重试同一批文件」 | 单轮预算与 24 reader/lane 上限保证了每轮工作量有界；文件消失会触发一次枚举把它移出跟踪（`monitor.rs:472`、`monitor.rs:834`），不会形成无限重试。 |
| 「Tokrate 把 CPU 打满」 | 单轮最多解析 1 MiB JSON，间隔 ≥ 2 s；解析量级是「每 2 s 一兆 JSON」，普通桌面 CPU 上远不到一个核。**需本机用任务管理器确认**（B）。 |

## 4. 修复前后对比

| 指标 | 修复前 | 修复后 | 依据 |
| --- | --- | --- | --- |
| 每个 reader 每轮 open 次数 | 2（对齐阶段 3） | 1 | `reader.rs:309` / `reader.rs:74` |
| 整机每轮最坏 open 次数 | ≤ 96（对齐 ≤ 120） | ≤ 48 | 24 live + 24 archive（`monitor.rs:356/415`） |
| 2 s 节拍下的 open 速率 | ≈ 48 次/s | ≈ 24 次/s | 同上 |
| 读取字节上界 | 1 MiB/轮 | 不变（1 MiB/轮） | `sources.rs:18` |
| 已读内容是否会被重复解析 | 否 | 否（新增测试锁定） | `tests/cockpit_contention.rs` |
| 「按旧 size 读新文件」的竞态 | 存在（两次 open） | 消除（同一句柄） | `reader.rs` |
| 单个小文件首次发现的读取量 | 2 × 文件大小 | 不变（已记录，§3.4-5） | `reader.rs:369` |

## 5. 必须在本机（真实 Windows + 真实 Cockpit）确认的部分

> **云端/CI 不等价**：Linux CI 既没有 `ReadDirectoryChangesW` 的内核缓冲行为、没有 NTFS 目录项元数据陈旧、也没有 Defender 的实时扫描过滤，更没有 Cockpit Tools 本体。以下每一条都必须在用户机器上复现。

1. **同相性**：Procmon（过滤 `tokrate.exe` 的 `CreateFile`/`ReadFile`、`cockpit*.exe` 的全部事件）观察 Cockpit 卡顿时刻是否与 Tokrate 的 2 s 轮询峰值重叠。若不同相，说明竞争不在 Tokrate 的读路径上。
2. **首次回放**：清空 Tokrate 历史与 checkpoint 后启动（模拟全新便携版首跑），用任务管理器记 `tokrate.exe` 的 I/O 读字节/秒与 CPU，同时操作 Cockpit。这是最可能复现「刚启动就卡」的场景（§2.1）。
3. **杀软放大**：Defender 实时保护开启/关闭各测一次同样的回放，比较 Cockpit 的响应时间。若差异显著，说明瓶颈是每次 open 的过滤驱动开销，而不是 Tokrate 的读量——那么 §3.1 把 open 减半就是最有效的改动。
4. **Cockpit 的打开方式**：确认 Cockpit 是否也对 `~/.codex/sessions`、`~/.claude/projects` 做递归扫描或对同一 jsonl 用独占模式打开；若是独占，方向会反过来——Tokrate 拿到 sharing violation（我们只重试，不阻塞它）。
5. **暂停监测后的句柄数**：应用 §3.2 的 patch 后，用 Process Explorer 对比「Monitoring paused」前后的 Handles 与线程数（预期各降约 9）。
6. **UI 卡顿归属**：应用 §3.3 后，观察 Tokrate flyout 的展开延迟是否与 `snapshot` 等待锁相关（可在 `snapshot` 前后打点）。这项只影响 Tokrate 自身，与 Cockpit 无关。

## 6. 压力测试

新增 `desktop/core/tests/cockpit_contention.rs`，只用 `tokrate_core` 的公开 API（等价于宿主的调用方式）：

| 测试 | 断言 |
| --- | --- |
| `a_poll_reads_bounded_bytes_and_never_repeats_what_it_read` | 每轮 ≤ `Monitor::MAX_POLL_BYTES`；读完后每轮 **0 字节**（不重复解析） |
| `many_session_files_keep_the_poll_cost_bounded` | 100 / 1000 / 10000 个 jsonl：每轮 ≤ 1 MiB，打印建文件耗时、首轮（含发现）耗时、最慢一轮、总字节 |
| `an_append_is_read_incrementally_not_from_the_start` | 50 次高频追加，每次读取 ≤ 本次追加字节；稳定后回到 0 |
| `a_concurrent_reader_and_writer_of_the_same_file_do_not_break_the_poll` | 另起线程反复读同一文件 + 另起线程持续追加：poll 不失败、单轮有界、最终追平 |
| `truncation_replacement_and_deletion_degrade_without_panicking` | 截断 / 原子替换（rename 覆盖）/ 删除 三种情况都不 panic 并追平 |
| `a_missing_root_degrades_without_blocking` | root 不存在时每轮 `NotFound`、0 字节、50 轮 < 10 s；出现/消失都能降级 |
| `a_checkpoint_resumes_without_rereading_and_does_not_hide_new_writes` | 从 checkpoint 恢复首轮 0 字节；新追加仍被读到；重读不超过「文件本体一次」 |
| `the_aggregate_source_monitor_honours_its_own_byte_budget` | `SourceMonitor` 层每轮 ≤ `SourceMonitor::MAX_POLL_BYTES` |
| `opening_a_file_another_reader_holds_still_succeeds` | 默认共享语义允许其他进程并发读 + 追加写 |
| `poll_signature_still_yields_a_result_of_records` | 公开签名仍是 `io::Result<Vec<TurnMetric>>`（防止上游改签名后测试静默失配） |

运行并取实测值：

```bash
cd desktop/core
cargo test --test cockpit_contention -- --nocapture
```

预期输出形如（数值随机器变化，用于填入 §2 的「B」级数据）：

```
[scale] 文件数   100 / 写入  ... / 首轮(含发现) ... / 单轮最多 ... 字节
[scale] 文件数 10000 / 写入  ... / 首轮(含发现) ... / 单轮最多 ... 字节
[append] 50 次追加共 ... 字节，每次只读增量
[concurrent] 外部读完成 ... 次 / 单轮最多 ... 字节
```

> 本次改动无法在本机编译（无 Rust 工具链），测试与修复均按逐行复核 diff 自查；请在 CI/本机先跑 `cargo test -p tokrate-core`（含既有 35 万行 `tests.rs` 回归）再合并。
