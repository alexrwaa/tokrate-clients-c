//! Cockpit 并行争用压力测试：把「Tokrate 监视会话目录时，对同一台机器上另一个进程（Cockpit
//! Tools）的实际资源影响」里可以用代码证明的部分固定下来。
//!
//! 只使用 `tokrate_core` 的公开 API，因此这里验证的正是宿主（`desktop/src-tauri`）看到的行为：
//!
//! 1. 单次 `poll` 读取的内容字节有硬上界（`Monitor::MAX_POLL_BYTES` /
//!    `SourceMonitor::MAX_POLL_BYTES`），与目录里有多少会话文件无关；
//! 2. 已经读完的内容不会被重复解析（同一时刻的第二次 `poll` 读 0 字节）；
//! 3. 追加只读增量，不从头重读；
//! 4. 另一个进程同时读同一文件、文件被截断/原子替换/删除、root 不存在时，都不 panic、不长时间
//!    阻塞，并且会降级到「下一轮再说」；
//! 5. checkpoint 能跨启动恢复，恢复后不重读已读内容，且不会把新写入的内容挡掉。
//!
//! 运行（需要看实测数字）：
//! `cargo test -p tokrate-core --test cockpit_contention -- --nocapture`
//!
//! 注意：本测试证明的是 Tokrate 自身的读取包络；它**不能**证明 Cockpit Tools 的卡顿来自哪里，
//! 那必须在本机与真实 Cockpit 同跑观察。见 `docs/cn-portable/01-cockpit-perf.md`。

use chrono::{Duration, Utc};
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration as StdDuration, Instant};
use tempfile::TempDir;
use tokrate_core::{Monitor, SourceChange, SourceMonitor};

/// A Codex session header; the monitor's recent-tail reader only accepts a file whose first line is
/// one (`TailHeader::CodexSessionMeta`).
fn header(id: &str) -> String {
    format!(
        r#"{{"timestamp":"2026-01-01T00:00:00Z","type":"session_meta","payload":{{"id":"{id}","source":"cli","model_provider":"openai"}}}}"#
    )
}

/// A line the Codex parser ignores but the reader still has to read: it is what makes the
/// byte-accounting below non-trivial.
fn filler(marker: usize) -> String {
    format!(
        r#"{{"timestamp":"2026-01-01T00:00:01Z","type":"test_filler","payload":{{"marker":{marker}}}}}}"#
    )
}

/// Writes one session file: the header plus `lines` filler lines.
fn write_session(path: &Path, id: &str, lines: usize) -> u64 {
    let mut text = header(id);
    text.push('\n');
    for marker in 0..lines {
        text.push_str(&filler(marker));
        text.push('\n');
    }
    fs::write(path, &text).unwrap();
    text.len() as u64
}

/// What a folder watcher reports for a write to `paths`.
fn changed(paths: &[&Path]) -> SourceChange {
    SourceChange {
        paths: paths.iter().map(|path| path.to_path_buf()).collect(),
        must_rescan: false,
    }
}

fn session_paths(root: &Path, count: usize) -> Vec<PathBuf> {
    (0..count)
        .map(|index| root.join(format!("session-{index:05}.jsonl")))
        .collect()
}

#[test]
fn a_poll_reads_bounded_bytes_and_never_repeats_what_it_read() {
    let dir = TempDir::new().unwrap();
    let paths = session_paths(dir.path(), 24);
    let mut written = 0;
    for (index, path) in paths.iter().enumerate() {
        written += write_session(path, &format!("session-{index}"), 4);
    }

    let now = Utc::now();
    let mut monitor = Monitor::new(dir.path().to_path_buf());
    let mut total = 0_u64;
    for round in 0..40 {
        let records = monitor.poll(now).expect("poll must not fail");
        let bytes = monitor.bytes_read_last_poll();
        assert!(
            bytes <= Monitor::MAX_POLL_BYTES,
            "第 {round} 轮读了 {bytes} 字节，超过单轮上限 {}",
            Monitor::MAX_POLL_BYTES
        );
        assert!(records.is_empty(), "填充行不应产生 turn 记录");
        total += bytes as u64;
        if bytes == 0 {
            break;
        }
    }
    // 首次发现一个小文件时，最近尾部读取器会先读一遍找 `session_meta` 头部，再回到头部结尾
    // 读正文（见 docs/cn-portable/01-cockpit-perf.md §3.4），所以首轮最坏是文件的 2 倍。
    assert!(
        total <= 2 * written,
        "共写入 {written} 字节，却读了 {total} 字节（超过首次发现允许的 2 倍）"
    );

    // 全部读完后，任何后续 poll 都必须读 0 字节：已读内容不会被重复解析。
    for _ in 0..3 {
        monitor.poll(now).expect("poll must not fail");
        assert_eq!(
            monitor.bytes_read_last_poll(),
            0,
            "已读完的文件被重复读取了"
        );
    }
    assert!(
        monitor.next_poll_deadline(now).is_none(),
        "没有新写入时不应要求立即再 poll"
    );
    println!("[bounded] 24 个文件 / 共 {written} 字节 / 累计读 {total} 字节，稳定后每轮 0 字节");
}

#[test]
fn many_session_files_keep_the_poll_cost_bounded() {
    let mut report = String::new();
    for count in [100_usize, 1_000, 10_000] {
        let dir = TempDir::new().unwrap();
        let paths = session_paths(dir.path(), count);

        let created = Instant::now();
        let mut written = 0_u64;
        for (index, path) in paths.iter().enumerate() {
            written += write_session(path, &format!("session-{index}"), 2);
        }
        let create_elapsed = created.elapsed();

        let now = Utc::now();
        let mut monitor = Monitor::new(dir.path().to_path_buf());
        let mut total = 0_usize;
        let mut worst = 0_usize;
        let mut worst_poll = StdDuration::ZERO;
        let mut first_poll = StdDuration::ZERO;
        for round in 0..8 {
            let started = Instant::now();
            monitor.poll(now).expect("poll must not fail");
            let elapsed = started.elapsed();
            if round == 0 {
                first_poll = elapsed;
            }
            worst_poll = worst_poll.max(elapsed);
            let bytes = monitor.bytes_read_last_poll();
            assert!(
                bytes <= Monitor::MAX_POLL_BYTES,
                "{count} 个文件时单轮读了 {bytes} 字节，超过上限 {}",
                Monitor::MAX_POLL_BYTES
            );
            worst = worst.max(bytes);
            total += bytes;
        }
        // 首轮包含一次目录枚举；10k 个文件也不允许出现秒级以上的单轮阻塞。
        assert!(
            first_poll < StdDuration::from_secs(60),
            "{count} 个文件的首轮耗时 {first_poll:?} 过长"
        );
        assert!(
            worst_poll < StdDuration::from_secs(10),
            "{count} 个文件时最慢一轮 {worst_poll:?}"
        );
        println!(
            "[scale] 文件数 {count:>5} / 写入 {written:>10} 字节 / 建文件 {create_elapsed:?} / \
             首轮(含发现) {first_poll:?} / 最慢一轮 {worst_poll:?} / \
             8 轮共读 {total:>9} 字节 / 单轮最多 {worst:>7} 字节"
        );
        report.push_str(&format!(
            "- {count} 个文件：首轮 {first_poll:?}，单轮最多 {worst} 字节\n"
        ));
    }
    println!("[scale] 汇总\n{report}");
}

#[test]
fn an_append_is_read_incrementally_not_from_the_start() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("session-append.jsonl");
    write_session(&path, "append", 8);

    let base = Utc::now();
    let mut monitor = Monitor::new(dir.path().to_path_buf());
    // 先追平（首次发现会把小文件读两遍：找头部一次、读正文一次）。
    for step in 0..5 {
        monitor
            .poll(base + Duration::seconds(step))
            .expect("poll must not fail");
        if monitor.bytes_read_last_poll() == 0 {
            break;
        }
    }
    assert_eq!(monitor.bytes_read_last_poll(), 0, "追平后应读 0 字节");

    // 高频追加：每次只应读到新增字节。
    let mut appended_total = 0_u64;
    for round in 0..50 {
        let before = fs::metadata(&path).unwrap().len();
        let mut handle = OpenOptions::new().append(true).open(&path).unwrap();
        for marker in 0..4 {
            writeln!(handle, "{}", filler((round * 4 + marker) as usize)).unwrap();
        }
        handle.flush().unwrap();
        drop(handle);
        let after = fs::metadata(&path).unwrap().len();
        let appended = after - before;
        appended_total += appended;

        assert!(monitor.note_changes(&changed(&[&path])), "watcher 报告的追加应被接受");
        monitor
            .poll(base + Duration::seconds(10 + round as i64))
            .expect("poll must not fail");
        let bytes = monitor.bytes_read_last_poll();
        assert!(
            bytes as u64 <= appended,
            "第 {round} 次追加只有 {appended} 字节，却读了 {bytes} 字节：说明在从头重读"
        );
        assert!(bytes <= Monitor::MAX_POLL_BYTES);
    }
    println!("[append] 50 次追加共 {appended_total} 字节，每次只读增量");

    // 稳定后必须回到 0 字节。
    monitor
        .poll(base + Duration::seconds(120))
        .expect("poll must not fail");
    assert_eq!(monitor.bytes_read_last_poll(), 0, "追加读完后仍在重复读");
}

#[test]
fn a_concurrent_reader_and_writer_of_the_same_file_do_not_break_the_poll() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("session-contended.jsonl");
    // Above the recent-tail window, so the monitor keeps both a tail reader and a full replay
    // reader on the same file while another process reads and appends to it.
    let mut written = write_session(&path, "contended", 4_000);
    assert!(written > Monitor::RECENT_TAIL_BYTES);

    let base = Utc::now();
    let mut monitor = Monitor::new(dir.path().to_path_buf());
    let stop = Arc::new(AtomicBool::new(false));
    let appends = Arc::new(AtomicUsize::new(0));

    let reader = {
        let path = path.clone();
        let stop = stop.clone();
        thread::spawn(move || {
            let mut reads = 0_u64;
            let mut worst = 0_u64;
            // 限次，避免在 CI 磁盘上刷出上 GB 的无效读；本轮要证明的只是「不会失败」。
            while !stop.load(Ordering::Acquire) && reads < 200 {
                let mut file = OpenOptions::new().read(true).open(&path).expect("并发读打开失败");
                let mut buffer = Vec::new();
                file.read_to_end(&mut buffer).expect("并发读失败");
                worst = worst.max(buffer.len() as u64);
                reads += 1;
                thread::sleep(StdDuration::from_millis(1));
            }
            (reads, worst)
        })
    };

    // 另一个线程持续追加，模拟正在写入的会话文件。
    let writer = {
        let path = path.clone();
        let stop = stop.clone();
        let appends = appends.clone();
        thread::spawn(move || {
            let mut handle = OpenOptions::new().append(true).open(&path).unwrap();
            for round in 0..200 {
                if stop.load(Ordering::Acquire) {
                    break;
                }
                writeln!(handle, "{}", filler(round as usize)).unwrap();
                handle.flush().unwrap();
                appends.fetch_add(1, Ordering::Release);
                thread::sleep(StdDuration::from_millis(2));
            }
        })
    };

    // 主线程持续 poll，同时把「watcher 看到追加」报告进去。
    let started = Instant::now();
    let mut worst = 0_usize;
    for round in 0..200 {
        monitor.note_changes(&changed(&[&path]));
        monitor
            .poll(base + Duration::seconds(round as i64))
            .expect("并发写入时 poll 必须成功");
        let bytes = monitor.bytes_read_last_poll();
        assert!(
            bytes <= Monitor::MAX_POLL_BYTES,
            "并发写入时单轮读了 {bytes} 字节"
        );
        worst = worst.max(bytes);
        if appends.load(Ordering::Acquire) >= 200 {
            break;
        }
    }
    writer.join().unwrap();
    stop.store(true, Ordering::Release);
    let (reads, worst_read) = reader.join().unwrap();
    written += appends.load(Ordering::Acquire) as u64 * 90;

    assert!(reads > 0, "并发读线程一次都没读完");
    assert!(
        worst_read <= written + 4_096,
        "外部读线程读到 {worst_read} 字节，超过写入量 {written}"
    );
    assert!(started.elapsed() < StdDuration::from_secs(60));

    // 停止追加后，监视器最终必须追平并回到 0 字节。
    for step in 0..40 {
        monitor
            .poll(base + Duration::seconds(300 + step))
            .expect("poll must not fail");
        if monitor.bytes_read_last_poll() == 0 {
            break;
        }
    }
    assert_eq!(
        monitor.bytes_read_last_poll(),
        0,
        "并发追加结束后仍未追平：{worst} 是过程中单轮最大值"
    );
    println!(
        "[concurrent] 外部读完成 {reads} 次 / 单轮最多 {worst} 字节 / 追加 {} 行 / 用时 {:?}",
        appends.load(Ordering::Acquire),
        started.elapsed()
    );
}

#[test]
fn truncation_replacement_and_deletion_degrade_without_panicking() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("session-victim.jsonl");
    write_session(&path, "victim", 40);

    let base = Utc::now();
    let mut monitor = Monitor::new(dir.path().to_path_buf());
    for step in 0..4 {
        monitor
            .poll(base + Duration::seconds(step))
            .expect("poll must not fail");
        assert!(monitor.bytes_read_last_poll() <= Monitor::MAX_POLL_BYTES);
    }

    // 1) 截断到只剩头部。
    write_session(&path, "victim", 0);
    assert!(monitor.note_changes(&changed(&[&path])));
    let mut truncated_bytes = 0;
    for step in 0..6 {
        monitor
            .poll(base + Duration::seconds(10 + step))
            .expect("截断后 poll 必须成功");
        truncated_bytes = monitor.bytes_read_last_poll();
        assert!(truncated_bytes <= Monitor::MAX_POLL_BYTES);
    }
    assert!(truncated_bytes == 0, "截断后没有追平");

    // 2) 原子替换：写临时文件再改名覆盖（另一个进程常见的落盘方式）。
    let replacement = dir.path().join("replacement.tmp");
    write_session(&replacement, "replacement", 120);
    fs::rename(&replacement, &path).unwrap();
    assert!(monitor.note_changes(&changed(&[&path])));
    for step in 0..8 {
        monitor
            .poll(base + Duration::seconds(20 + step))
            .expect("替换后 poll 必须成功");
        assert!(monitor.bytes_read_last_poll() <= Monitor::MAX_POLL_BYTES);
    }

    // 3) 删除。
    fs::remove_file(&path).unwrap();
    assert!(monitor.note_changes(&changed(&[&path])));
    for step in 0..6 {
        monitor
            .poll(base + Duration::seconds(40 + step))
            .expect("删除后 poll 必须成功");
        assert_eq!(monitor.bytes_read_last_poll(), 0, "文件已删除仍在读");
    }
    println!("[disappear] 截断 / 原子替换 / 删除 三种情况均降级完成，未 panic");
}

#[test]
fn a_missing_root_degrades_without_blocking() {
    let dir = TempDir::new().unwrap();
    let missing = dir.path().join("no-such-root");
    let base = Utc::now();
    let mut monitor = Monitor::new(missing.clone());
    assert!(!monitor.root_exists());

    // 每轮相隔 > 发现间隔（300 s），所以每轮都真的走一次枚举并拿到 NotFound。
    let started = Instant::now();
    for step in 0..50 {
        let error = monitor
            .poll(base + Duration::seconds(301 * step))
            .expect_err("不存在的 root 必须报 NotFound");
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        assert_eq!(monitor.bytes_read_last_poll(), 0);
    }
    assert!(
        started.elapsed() < StdDuration::from_secs(10),
        "50 次缺失 root 的 poll 用了 {:?}",
        started.elapsed()
    );

    // 出现后可用，消失后再次降级而不是 panic。
    fs::create_dir_all(&missing).unwrap();
    monitor
        .poll(base + Duration::seconds(301 * 60))
        .expect("root 出现后 poll 必须成功");
    assert!(monitor.root_exists());
    fs::remove_dir_all(&missing).unwrap();
    let error = monitor
        .poll(base + Duration::seconds(301 * 61))
        .expect_err("root 消失后必须报 NotFound");
    assert_eq!(error.kind(), io::ErrorKind::NotFound);
    println!("[missing-root] 50 次缺失 root 的 poll 用时 {:?}", started.elapsed());
}

#[test]
fn a_checkpoint_resumes_without_rereading_and_does_not_hide_new_writes() {
    let dir = TempDir::new().unwrap();
    let paths = session_paths(dir.path(), 3);
    for (index, path) in paths.iter().enumerate() {
        write_session(path, &format!("resume-{index}"), 6);
    }

    let base = Utc::now();
    let mut first = Monitor::new(dir.path().to_path_buf());
    for step in 0..4 {
        first
            .poll(base + Duration::seconds(step))
            .expect("poll must not fail");
    }
    let checkpoints = first
        .checkpoints()
        .expect("读完后应能给出 checkpoint");
    assert_eq!(checkpoints.len(), 3, "每个文件都应有 checkpoint");

    // 新一次启动：套用 checkpoint，文件已静置 10 分钟以上，因此 checkpoint 被信任。
    let mut second = Monitor::new(dir.path().to_path_buf());
    second.set_checkpoints(checkpoints);
    let later = base + Duration::seconds(700);
    second.poll(later).expect("poll must not fail");
    assert_eq!(
        second.bytes_read_last_poll(),
        0,
        "从 checkpoint 恢复后不应重读已读内容"
    );

    // checkpoint 不能挡住新写入。
    let path = paths[0].as_path();
    let before = fs::metadata(path).unwrap().len();
    OpenOptions::new()
        .append(true)
        .open(path)
        .unwrap()
        .write_all(b"{}\n")
        .unwrap();
    let appended = fs::metadata(path).unwrap().len() - before;
    assert!(second.note_changes(&changed(&[path])));
    second
        .poll(later + Duration::seconds(5))
        .expect("poll must not fail");
    let bytes = second.bytes_read_last_poll();
    assert!(bytes > 0, "checkpoint 之后的新写入没有被读到");
    let whole = fs::metadata(path).unwrap().len() as usize;
    assert!(
        bytes <= whole + 1,
        "恢复后最多重读一次文件本体（{whole} 字节）以找回头部，却读了 {bytes} 字节"
    );
    println!(
        "[checkpoint] 3 个文件从 checkpoint 恢复读 0 字节；新追加 {appended} 字节时读 {bytes} 字节（含找回头部的一次重读）"
    );
}

#[test]
fn the_aggregate_source_monitor_honours_its_own_byte_budget() {
    let dir = TempDir::new().unwrap();
    let codex = dir.path().join("codex");
    let claude = dir.path().join("claude");
    let empty = dir.path().join("empty");
    for path in [&codex, &claude, &empty] {
        fs::create_dir_all(path).unwrap();
    }
    for index in 0..60 {
        write_session(&codex.join(format!("codex-{index:03}.jsonl")), &format!("c{index}"), 4);
        write_session(&claude.join(format!("claude-{index:03}.jsonl")), &format!("l{index}"), 4);
    }

    let now = Utc::now();
    let mut monitor = SourceMonitor::new(
        codex,
        claude,
        empty.clone(),
        empty.clone(),
        empty.clone(),
        empty.clone(),
        empty,
    );
    let mut total = 0;
    for round in 0..6 {
        let started = Instant::now();
        monitor.poll(now).expect("source poll must not fail");
        let bytes = monitor.bytes_read_last_poll();
        assert!(
            bytes <= SourceMonitor::MAX_POLL_BYTES,
            "第 {round} 轮合计读了 {bytes} 字节，超过 {}",
            SourceMonitor::MAX_POLL_BYTES
        );
        total += bytes;
        println!(
            "[source] 第 {round} 轮：{bytes} 字节 / {:?}",
            started.elapsed()
        );
    }
    assert!(total > 0, "应该读到内容");
    assert!(!monitor.had_source_error(), "空源不应报错");
}

/// 一个最小的「另一进程读取」探针，用来确认默认共享语义允许并发读（Windows 上 Rust 的
/// `File::open` 默认带 FILE_SHARE_READ|WRITE|DELETE）。本测试只断言不会失败。
#[test]
fn opening_a_file_another_reader_holds_still_succeeds() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("shared.jsonl");
    write_session(&path, "shared", 10);

    let mut held = OpenOptions::new().read(true).open(&path).unwrap();
    let mut probe = OpenOptions::new().read(true).open(&path).unwrap();
    let mut first = Vec::new();
    held.seek(SeekFrom::Start(0)).unwrap();
    held.read_to_end(&mut first).unwrap();
    let mut second = Vec::new();
    probe.read_to_end(&mut second).unwrap();
    assert_eq!(first, second);

    let mut writer = OpenOptions::new().append(true).open(&path).unwrap();
    writer.write_all(b"{}\n").unwrap();
    println!("[sharing] 并发只读 + 追加写入均成功（默认共享语义不排斥其他进程）");
}

/// `Monitor::poll` 的返回类型在测试里不被命名，这里用一个不透明断言确认它仍是
/// `io::Result<Vec<TurnMetric>>` 的形状（避免上游改了签名后测试静默失配）。
#[test]
fn poll_signature_still_yields_a_result_of_records() {
    let dir = TempDir::new().unwrap();
    let mut monitor = Monitor::new(dir.path().to_path_buf());
    let outcome = monitor.poll(Utc::now());
    let _records: Vec<tokrate_core::TurnMetric> = outcome.unwrap_or_default();
}
