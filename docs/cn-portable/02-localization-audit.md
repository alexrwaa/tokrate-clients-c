# 02 · 中文本地化审计（Tokrate-CN Portable）

- 审计对象：`tokrate-cn` 工作区（Fork：alexrwaa/tokrate-clients-c），HEAD `d9955c7` + 并行开发中的未提交改动
- 审计时间：2026-11-16 23:18（B 仍在并行迁移组件，数字随时变化）
- 审计方式：只读扫描 + 人工抽样阅读；不改任何源码
- 工具：`node desktop/scripts/i18n-coverage-audit.mjs`

> 说明：本文件是**审计时刻的快照**。B 智能体仍在把组件迁移到 `t()`，A/C 仍在改 Rust 侧文案，
> 数字会变化（同日 23:05 为 160 处，23:18 已降到 49 处）。发布前必须用同一脚本重跑，以最后一次结果为准。

---

## 1. 结论摘要（23:20 实测）

| 指标 | 数值 | 说明 |
| --- | --- | --- |
| 扫描的 `.ts/.tsx` 文件 | 35 | 已排除 `desktop/ui/i18n/**`、`*.test.*`、`node_modules` |
| 仍含硬编码界面文案的文件 | 10 | 见第 4 节清单 |
| 硬编码文案总数 | 39 处 | JSX 文本节点 + `aria-label/title/placeholder/alt/label/hint/description` 属性 |
| 其中英文 | 39 处 | 扫描时刻没有硬编码中文残留（中文都在字典里） |
| 已接入 `t()` / `useI18n` 的文件 | 4（在仍有硬编码的 10 个文件中） | `Header.tsx`、`Hero.tsx`、`Models.tsx`、`TrendChart.tsx` 已接入但仍有残留 |
| 中文字典条目 | 436+ 条 | `desktop/ui/i18n/zh-CN.ts`（525 行，B 仍在补充） |
| 英文字典条目 | 与中文同键为主 | `desktop/ui/i18n/en-US.ts`（533 行），英文是回退基准 |

**判定：仍未达到“界面全中文”的验收标准，但已从“主体英文”推进到“少量残留”。**
数字在 20 分钟内从 160 降到 39（B 正在并行迁移），说明工作有效，但**不能以“正在下降”代替“已清零”**。
剩余集中在共享同意页、效率说明、更新页等需要用户理解的页面。

**发布门禁建议：** `totalHardcodedStrings == 0`（或剩余项在字典中登记为刻意保留），
且共享同意页、设置页、首次引导必须清零。

---

## 2. 已完成的本地化工作（有代码可查）

| 项 | 证据 | 状态 |
| --- | --- | --- |
| 双语字典与运行时 | `desktop/ui/i18n/index.ts`、`zh-CN.ts`、`en-US.ts` | 已完成 |
| 默认语言为简体中文 | `i18n/index.ts` `DEFAULT_LANGUAGE = "zh-CN"` | 已完成 |
| 语言选择持久化 | `i18n/index.ts` 写入 `localStorage["tokrate-cn.language"]`，随 `data/webview/` 一起移动 | 已完成 |
| 缺键回退英文 | `i18n/index.ts` 注释与实现：中文缺键回退 `en-US`，不会出现空白界面 | 已完成 |
| 托盘菜单 / 提示 | `desktop/src-tauri/src/main.rs`：`打开仪表盘`、`完整历史记录`、`等待响应中`、`退出 Tokrate-CN`、tooltip `Tokrate-CN — 响应吞吐率` | 已完成 |
| 历史窗口标题 | `desktop/src-tauri/src/flyout.rs`：`Tokrate-CN 历史记录` | 已完成 |
| 原生选择目录对话框标题 | `main.rs` `choose_folder`：6 个数据源均为中文标题 | 已完成 |
| 数据源指标文案 | `desktop/ui/metrics.ts` 已改用 `t()`（如 `metric.providerRoute`、`metric.unknownRoute`） | 已完成 |
| 启动失败提示 | `desktop/src-tauri/src/portable.rs` `report_fatal` 中文错误 + 原生消息框 | 已完成 |

---

## 3. 按界面区域的覆盖清单

| 界面区域 | 主要文件 | 状态（23:18） | 证据 / 缺口 |
| --- | --- | --- | --- |
| 托盘菜单、tooltip | `desktop/src-tauri/src/main.rs` | 已汉化 | 菜单与 tooltip 字符串均为中文 |
| 窗口标题（主窗/历史窗） | `tauri.conf.json`、`flyout.rs` | 已汉化 | `Tokrate-CN`、`Tokrate-CN 历史记录` |
| 设置页 | `components/Settings.tsx` | 已清零（待复核） | 本次扫描未再检出硬编码；包含语言区块 |
| 语言切换入口 | `components/Settings.tsx:123-137,206` | 已实现 | `useI18n()` 提供 `language/setLanguage`，中/英两选项 |
| 仪表盘头部 / 模型选择器 | `components/Header.tsx` | 已接入，残留 1 | 仅剩 1 处；主体已走 `t()` |
| 仪表盘主体 / Hero | `components/Hero.tsx`、`App.tsx` | 已接入，残留 1 | `App.tsx` 已清零 |
| 历史记录 | `components/History.tsx` | 已清零（待复核） | 本次扫描未再检出 |
| 趋势图 | `components/Trend.tsx`、`TrendChart.tsx` | 基本完成 | `Trend.tsx` 清零；`TrendChart.tsx` 残留 1 |
| 模型列表 | `components/Models.tsx` | 已接入，残留 2 | 多为 `tok/s` 等单位（可保留） |
| 效率说明 | `components/Efficiency.tsx` | **未汉化** | 10 处，如 `Indicator`、`Eligible requests`、`7 d · 200 tokens or more` |
| 社区看板 | `components/Community.tsx` | **未汉化** | 6 处，如 `Community`、`Community details` |
| 首次引导 | `components/Onboarding.tsx` | **未汉化** | 4 处 |
| 共享同意页（合规关键） | `components/SharingChoice.tsx`、`ConsentSheet.tsx` | **未汉化** | 15 处；同意文案必须让用户看懂 |
| 更新页 | `components/Updates.tsx` | **未汉化** | 7 处，如 `Checking for updates…` |
| 页脚 / 基础组件 | `Footer.tsx`、`primitives.tsx` | **未汉化** | 各 1 处 |
| 运行时状态文案 | `desktop/src-tauri/src/runtime.rs` | **未汉化** | 如 L689 `Local only`、L755 `Sharing new turns`、L841 `Monitoring paused`、L1454 `Community unavailable...` |
| 系统通知正文 | `desktop/src-tauri/src/notifier.rs` + `runtime.rs` | 未验证 | 未逐条核对通知标题/正文是否中文 |

---

## 4. 未覆盖文件清单（23:20 快照，数量仍在下降）

| 文案数 | 文件 | 备注 |
| ---: | --- | --- |
| 13 | `desktop/ui/components/SharingChoice.tsx` | 合规关键，必须优先 |
| 10 | `desktop/ui/components/Efficiency.tsx` | 说明性长文案多 |
| 7 | `desktop/ui/components/Updates.tsx` | 便携版已禁用更新器，需同步改文案 |
| 2 | `desktop/ui/components/ConsentSheet.tsx` | 同意弹层 |
| 2 | `desktop/ui/components/Models.tsx` | 已接入 `t()`，残留 2 |
| 1 | `desktop/ui/components/Header.tsx` | 已接入 `t()`，残留 1 |
| 1 | `desktop/ui/components/Hero.tsx` | 已接入 `t()`，残留 1 |
| 1 | `desktop/ui/components/TrendChart.tsx` | 已接入 `t()`，残留 1 |
| 1 | `desktop/ui/components/Footer.tsx` | |
| 1 | `desktop/ui/components/primitives.tsx` | |

> 已在本次开发中清零（复核时不再检出）：`App.tsx`、`History.tsx`、`Settings.tsx`、`Trend.tsx`、
> `Community.tsx`、`Onboarding.tsx`、`metrics.ts`、`model/*`。
>
> 注：同一行内的 `aria-label` 与可见文本会被分别计数，因此“文案数”不等于“去重字符串数”；
> 该数字用于判断迁移工作量与是否清零，不作为翻译词条统计。

---

## 5. 审计方法与复核标准

```bash
# 汇总
node desktop/scripts/i18n-coverage-audit.mjs
# 机器可读（含每一条文案的 文件:行号）
node desktop/scripts/i18n-coverage-audit.mjs --json
```

脚本判定规则：

- 只统计 JSX 文本节点与列出的属性，不统计 `console.*`、注释、测试夹具、`tok/s` 这类单位；
- 中英文都算“硬编码”，只有走 `t("key")` 的才不计入；
- 已按约定排除 `desktop/ui/i18n/**`。

**通过标准（建议写入发布门禁）：**

1. `totalHardcodedStrings == 0`，或剩余项全部在 `i18n` 字典中登记为“刻意保留英文”（如 `tok/s`、模型名、产品名）；
2. 界面存在语言切换入口，切换后无需重启即可生效；
3. Rust 侧可见状态与通知正文全部中文（可用 `grep -n 'status = "' desktop/src-tauri/src/runtime.rs` 复核）；
4. 在 Windows 上人工走查：托盘右键菜单、主窗、设置、历史、共享同意页、错误提示。

---

## 6. 风险与提醒

1. **合规文案未汉化是高风险项。** 共享同意页 `SharingChoice.tsx`（13 处）与 `ConsentSheet.tsx`（2 处）仍为英文，用户可能在未理解“会上传什么”的情况下开启共享。发布前必须优先完成。
2. **语言切换已提供**（`Settings.tsx:123-137,206`），但切换后各页面的即时刷新需要人工验证（字典是运行时 store，理论上是响应式的）。
3. **Rust 状态文案是英文。** 这些字符串直接渲染在仪表盘状态栏，属于用户高频可见区域；B 的字典覆盖不到 Rust。
4. **数字下降不等于完成。** 剩余 39 处中有 15 处在合规/引导页面，恰恰是最不能遗漏的部分；必须重跑脚本确认清零。
5. 本审计**不评价翻译质量**（术语一致性、语气），只评价“是否还有硬编码”。翻译质量需人工评审。

---

## 7. 关联文档

- 验收结论与证据：`docs/cn-portable/03-acceptance-report.md`
- 用户侧说明：`docs/cn-portable/04-user-guide-zh.md`
- 本机复核步骤：`docs/cn-portable/06-local-verification-steps.md`
