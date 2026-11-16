#!/usr/bin/env node
// Builds the Tokrate-CN portable ZIP (Windows x64) from the release executable.
//
// Layout produced inside dist/Tokrate-CN-Portable-win-x64.zip:
//   Tokrate-CN-Portable/
//     Tokrate-CN.exe        (copy of desktop/src-tauri/target/release/tokrate-desktop.exe)
//     data/                 (empty directory, must survive the ZIP round trip)
//     README-CN.txt         (Chinese usage notes, ASCII file name)
//
// The ZIP is written with Node built-ins only (zlib + a minimal ZIP writer) so the
// archive is reproducible and the empty data/ directory is guaranteed to be a real
// directory entry, which Compress-Archive is not reliable about on Windows
// PowerShell 5.1.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(DESKTOP_DIR, '..');
const DEFAULT_EXE = join(DESKTOP_DIR, 'src-tauri', 'target', 'release', 'tokrate-desktop.exe');
const EXE = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_EXE;

const DIST_DIR = join(REPO_ROOT, 'dist');
const STAGE_NAME = 'Tokrate-CN-Portable';
const STAGE_DIR = join(DIST_DIR, STAGE_NAME);
const ZIP_NAME = 'Tokrate-CN-Portable-win-x64.zip';
const ZIP_PATH = join(DIST_DIR, ZIP_NAME);
const SHA_PATH = `${ZIP_PATH}.sha256`;
const MANIFEST_PATH = join(DIST_DIR, 'Tokrate-CN-Portable-manifest.json');
const PORTABLE_EXE_NAME = 'Tokrate-CN.exe';
const README_NAME = 'README-CN.txt';

// Fixed timestamp so identical inputs produce an identical archive. 2024-01-01 00:00.
const DOS_TIME = 0;
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;

const README_TEXT = `Tokrate-CN 便携版（Windows x64）
================================

解压即用
  把整个 Tokrate-CN-Portable 文件夹解压到任意可写位置（例如 D:\\Tools\\Tokrate-CN），
  双击 Tokrate-CN.exe 即可运行：不写注册表项、不需要管理员权限、没有安装程序。
  请不要放在 C:\\Program Files 这类需要提权的目录里。

数据保存在 data/
  设置、历史记录和 WebView2 缓存都写在 exe 同目录的 data 文件夹内，
  不会写入 C 盘的用户目录（%LOCALAPPDATA%、%APPDATA%）。
  - 备份 / 换机器：把整个文件夹一起拷走即可（先退出程序）。
  - 卸载：退出程序后直接删除整个文件夹。
  - 便携模式要求 exe 同目录存在可写的 data 目录；若 data 无法创建，程序会直接报错退出，
    不会退回写 C 盘。

运行要求
  需要系统已安装 Microsoft Edge WebView2 Runtime。
  Windows 11 已内置；Windows 10 通常随 Edge 一起安装。
  如果提示缺少 WebView2，请到微软官网下载 "WebView2 Runtime"（Evergreen 版）安装后重试。

切换中英文
  在应用内的设置 / 语言选项中切换，选择会保存在 data 目录里，下次启动沿用上次的选择。

升级
  下载新的 ZIP，退出程序后只替换 Tokrate-CN.exe，保留 data 目录，数据不会丢失。
  便携版不做自动更新，程序不会自行联网下载新版本。

问题反馈
  反馈时请附上：Windows 版本、是否已安装 WebView2、程序版本，以及 data 目录下可读的日志。
`;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toEntryName(absolutePath, isDirectory) {
  const relative = absolutePath.slice(DIST_DIR.length + 1).split(sep).join('/');
  return isDirectory ? `${relative}/` : relative;
}

/**
 * Minimal ZIP writer (store/deflate, no zip64). Entries keep UTF-8 names and
 * directories are emitted as real directory entries.
 */
function buildZip(entries) {
  if (entries.length > 0xffff) {
    throw new Error(`Too many ZIP entries: ${entries.length}`);
  }
  const chunks = [];
  const centralRecords = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const isDirectory = entry.name.endsWith('/');
    const raw = isDirectory ? Buffer.alloc(0) : entry.data;
    if (raw.length > 0xffffffff) {
      throw new Error(`Entry too large for a non-zip64 archive: ${entry.name}`);
    }
    let method = 0;
    let body = raw;
    if (!isDirectory && raw.length > 0) {
      const deflated = deflateRawSync(raw, { level: 9 });
      if (deflated.length < raw.length) {
        method = 8;
        body = deflated;
      }
    }
    const crc = isDirectory ? 0 : crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed to extract
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 name flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(DOS_TIME, 10);
    localHeader.writeUInt16LE(DOS_DATE, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(body.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    chunks.push(localHeader, nameBytes, body);
    centralRecords.push({
      nameBytes,
      method,
      crc,
      compressedSize: body.length,
      uncompressedSize: raw.length,
      offset,
      isDirectory,
    });
    offset += localHeader.length + nameBytes.length + body.length;
  }

  const centralOffset = offset;
  for (const record of centralRecords) {
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by (MS-DOS/FAT)
    centralHeader.writeUInt16LE(20, 6); // version needed to extract
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 name flag
    centralHeader.writeUInt16LE(record.method, 10);
    centralHeader.writeUInt16LE(DOS_TIME, 12);
    centralHeader.writeUInt16LE(DOS_DATE, 14);
    centralHeader.writeUInt32LE(record.crc, 16);
    centralHeader.writeUInt32LE(record.compressedSize, 20);
    centralHeader.writeUInt32LE(record.uncompressedSize, 24);
    centralHeader.writeUInt16LE(record.nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal attributes
    centralHeader.writeUInt32LE(record.isDirectory ? 0x10 : 0x20, 38); // MS-DOS attributes
    centralHeader.writeUInt32LE(record.offset, 42);

    chunks.push(centralHeader, record.nameBytes);
    offset += centralHeader.length + record.nameBytes.length;
  }

  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4); // this disk
  endOfCentralDirectory.writeUInt16LE(0, 6); // disk with central directory
  endOfCentralDirectory.writeUInt16LE(centralRecords.length, 8);
  endOfCentralDirectory.writeUInt16LE(centralRecords.length, 10);
  endOfCentralDirectory.writeUInt32LE(offset - centralOffset, 12);
  endOfCentralDirectory.writeUInt32LE(centralOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20); // comment length
  chunks.push(endOfCentralDirectory);

  return Buffer.concat(chunks);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function mib(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function fail(message) {
  console.error(`[package-portable] error: ${message}`);
  process.exit(1);
}

function main() {
  if (!existsSync(EXE)) {
    fail(
      `release executable not found: ${EXE}\n` +
        '  Build it first: cd desktop && npm run tauri -- build --features custom-protocol --no-bundle',
    );
  }
  const exeStat = statSync(EXE);
  if (!exeStat.isFile() || exeStat.size < 1024 * 1024) {
    fail(`release executable looks wrong (${exeStat.size} bytes): ${EXE}`);
  }

  mkdirSync(DIST_DIR, { recursive: true });
  rmSync(STAGE_DIR, { recursive: true, force: true });
  rmSync(ZIP_PATH, { force: true });
  rmSync(SHA_PATH, { force: true });
  rmSync(MANIFEST_PATH, { force: true });

  mkdirSync(join(STAGE_DIR, 'data'), { recursive: true });

  const stagedExe = join(STAGE_DIR, PORTABLE_EXE_NAME);
  copyFileSync(EXE, stagedExe);

  const readmePath = join(STAGE_DIR, README_NAME);
  // UTF-8 with BOM + CRLF so Windows Notepad renders the Chinese text correctly.
  const readmeBody = `\ufeff${README_TEXT.replace(/\r?\n/g, '\r\n')}`;
  writeFileSync(readmePath, readmeBody, { encoding: 'utf8' });

  const exeBytes = readFileSync(stagedExe);
  const readmeBytes = readFileSync(readmePath);
  const entries = [
    { name: `${STAGE_NAME}/`, data: Buffer.alloc(0) },
    { name: toEntryName(join(STAGE_DIR, 'data'), true), data: Buffer.alloc(0) },
    { name: toEntryName(stagedExe, false), data: exeBytes },
    { name: toEntryName(readmePath, false), data: readmeBytes },
  ];

  const archive = buildZip(entries);
  writeFileSync(ZIP_PATH, archive);

  const zipHash = sha256(archive);
  writeFileSync(SHA_PATH, `${zipHash}  ${ZIP_NAME}\n`, { encoding: 'utf8' });

  const manifest = {
    generatedBy: 'desktop/scripts/package-portable.mjs',
    archive: ZIP_NAME,
    archiveBytes: archive.length,
    archiveSha256: zipHash,
    sourceExecutable: 'desktop/src-tauri/target/release/tokrate-desktop.exe',
    sourceVisiblePath: EXE,
    sourceBytes: exeStat.size,
    entries: entries.map((entry) => ({
      name: entry.name,
      bytes: entry.data.length,
      directory: entry.name.endsWith('/'),
    })),
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8' });

  for (const entry of manifest.entries) {
    const kind = entry.directory ? 'dir ' : 'file';
    console.log(`[package-portable] ${kind} ${entry.name} (${entry.bytes} bytes)`);
  }
  console.log(`[package-portable] archive ${ZIP_PATH} (${mib(archive.length)})`);
  console.log(`[package-portable] sha256 ${zipHash}`);
  console.log(
    JSON.stringify({
      ok: true,
      archive: ZIP_PATH,
      sha256: zipHash,
      bytes: archive.length,
      manifest: MANIFEST_PATH,
    }),
  );
}

main();
