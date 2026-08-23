/**
 * src/module/xvfbManager.js
 * Self-contained Xvfb auto-installer & manager for unprivileged / container environments.
 * Auto-downloads Ubuntu .deb packages, extracts binaries & shared libraries,
 * patches xkbcomp paths for rootless environments, and spawns the virtual X11 server on :99.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync, spawn } = require('child_process');

const VENDOR_DIR = path.join(__dirname, '..', '..', 'vendor', 'xvfb');
const BIN_PATH = path.join(VENDOR_DIR, 'Xvfb');
const TMP_BIN = '/tmp/xvfb-vendor-Xvfb';
const DEB_URL = 'http://archive.ubuntu.com/ubuntu/pool/universe/x/xorg-server/xvfb_21.1.12-1ubuntu1.5_amd64.deb';
const DEB_PATH = path.join(VENDOR_DIR, 'xvfb.deb');

const LIB_DIR = path.join(VENDOR_DIR, 'libs');

const KNOWN_DEB_LIBS = {
  'libunwind.so.8': 'http://archive.ubuntu.com/ubuntu/pool/main/libu/libunwind/libunwind8_1.3.2-2build2.1_amd64.deb',
  'libXfont2.so.2': 'http://archive.ubuntu.com/ubuntu/pool/main/libx/libxfont/libxfont2_2.0.5-1build1_amd64.deb',
  'libfontenc.so.1': 'http://archive.ubuntu.com/ubuntu/pool/main/libf/libfontenc/libfontenc1_1.1.4-1build3_amd64.deb',
  'libxkbfile.so.1': 'http://archive.ubuntu.com/ubuntu/pool/main/libx/libxkbfile/libxkbfile1_1.1.0-1build3_amd64.deb',
};

const XKB_UTILS_DEB_URL = 'http://archive.ubuntu.com/ubuntu/pool/main/x/x11-xkb-utils/x11-xkb-utils_7.7+5build4_amd64.deb';
const XKB_DATA_DEB_URL = 'http://archive.ubuntu.com/ubuntu/pool/main/x/xkeyboard-config/xkb-data_2.33-1_all.deb';

const XKB_BIN_DIRECTORY = '/usr/bin';
const XKB_BIN_DIR_REPLACEMENT = '/tmp/xkb';
const XKBCOMP_RUNTIME_PATH = '/tmp/xkb/xkbcomp';
const XKBCOMP_VENDOR_PATH = path.join(VENDOR_DIR, 'xkbcomp');
const XKB_DATA_DIR = path.join(VENDOR_DIR, 'xkb-data', 'usr', 'share', 'X11', 'xkb');

let _xvfbProc = null;
let _displayNum = null;
let _ensureXvfbInFlight = null;

function log(msg) { console.log(`[Xvfb-Manager] ${msg}`); }
function warn(msg) { console.warn(`[Xvfb-Manager] ⚠️  ${msg}`); }
function err(msg) { console.error(`[Xvfb-Manager] ❌ ${msg}`); }

function fileExists(p) {
  try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
}

function isDisplayUp(num) {
  if (_xvfbProc && !_xvfbProc.killed && String(_displayNum) === String(num)) {
    return true;
  }
  const lockFile = `/tmp/.X${num}-lock`;
  try {
    const pidStr = fs.readFileSync(lockFile, 'utf8').trim();
    const pid = parseInt(pidStr, 10);
    if (pid) {
      process.kill(pid, 0);
      return true;
    }
  } catch (e) {
    if (e.code === 'EPERM') return true;
  }
  return false;
}

function cleanupStaleLock(num) {
  const lockFile = `/tmp/.X${num}-lock`;
  const socketFile = `/tmp/.X11-unix/X${num}`;
  if (fs.existsSync(lockFile) && !isDisplayUp(num)) {
    try { fs.rmSync(lockFile, { force: true }); log(`Hapus stale lock: ${lockFile}`); } catch { }
    try { fs.rmSync(socketFile, { force: true }); } catch { }
  }
}

function findFreeDisplay(start = 99) {
  for (let n = start; n < start + 20; n++) {
    if (!isDisplayUp(n)) return n;
  }
  return start;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    const req = proto.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        try { fs.unlinkSync(dest); } catch { }
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    req.on('error', (e) => { file.close(); try { fs.unlinkSync(dest); } catch { } reject(e); });
  });
}

function patchXkbcompPathInBinary(binPath) {
  const buf = fs.readFileSync(binPath);
  const oldDir = Buffer.from(XKB_BIN_DIRECTORY + '\0', 'utf8');
  const newDir = Buffer.from(XKB_BIN_DIR_REPLACEMENT + '\0', 'utf8');

  if (newDir.length !== oldDir.length) return false;

  const idx = buf.indexOf(oldDir);
  if (idx === -1) {
    const alreadyPatched = buf.indexOf(Buffer.from(XKB_BIN_DIR_REPLACEMENT + '\0', 'utf8')) !== -1;
    if (alreadyPatched) {
      log(`xkbcomp path sudah dipatch sebelumnya (${XKB_BIN_DIR_REPLACEMENT}).`);
      return true;
    }
    return false;
  }

  newDir.copy(buf, idx);
  fs.writeFileSync(binPath, buf);
  log(`✅ Binary Xvfb di-patch: "${XKB_BIN_DIRECTORY}" → "${XKB_BIN_DIR_REPLACEMENT}"`);
  return true;
}

function getMissingLibs(binPath) {
  try {
    const lddOut = execSync(`ldd "${binPath}" 2>&1`, { encoding: 'utf8' });
    return lddOut
      .split('\n')
      .filter(l => l.includes('not found'))
      .map(l => l.trim().split(' ')[0])
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function installVendorLib(soname, url) {
  fs.mkdirSync(LIB_DIR, { recursive: true });
  const tmpDeb = path.join(VENDOR_DIR, `_tmp_${soname.replace(/[^a-zA-Z0-9.]/g, '_')}.deb`);
  const extractDir = path.join(VENDOR_DIR, `_extract_${soname.replace(/[^a-zA-Z0-9.]/g, '_')}`);

  log(`Mengunduh shared library ${soname}...`);
  await download(url, tmpDeb);

  fs.mkdirSync(extractDir, { recursive: true });
  execSync(`dpkg-deb -x "${tmpDeb}" "${extractDir}"`, { stdio: 'ignore' });

  let copied = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.so(\.|$)/.test(entry.name)) {
        const dest = path.join(LIB_DIR, entry.name);
        fs.copyFileSync(full, dest);
        try { fs.chmodSync(dest, 0o755); } catch { }
        copied++;
      }
    }
  };
  try { walk(extractDir); } catch { }

  try { fs.rmSync(tmpDeb, { force: true }); } catch { }
  try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { }

  if (copied > 0) {
    log(`✅ ${soname} terpasang di vendor libs (${copied} file disalin)`);
  }
}

async function ensureLibsFor(binPath, maxPasses = 3) {
  for (let pass = 0; pass < maxPasses; pass++) {
    const missing = getMissingLibs(binPath);
    if (!missing.length) return true;

    const known = missing.filter(m => KNOWN_DEB_LIBS[m]);
    if (!known.length) return false;

    for (const soname of known) {
      try {
        await installVendorLib(soname, KNOWN_DEB_LIBS[soname]);
      } catch (e) {
        err(`Gagal install dependency ${soname}: ${e.message}`);
      }
    }
  }
  return getMissingLibs(binPath).length === 0;
}

async function ensureXkb() {
  if (!fs.existsSync(XKB_DATA_DIR)) {
    try {
      log('Mengunduh xkb-data (config keyboard XKB)...');
      const tmpDeb = path.join(VENDOR_DIR, '_tmp_xkbdata.deb');
      const extractDir = path.join(VENDOR_DIR, '_extract_xkbdata');
      await download(XKB_DATA_DEB_URL, tmpDeb);
      fs.mkdirSync(extractDir, { recursive: true });
      execSync(`dpkg-deb -x "${tmpDeb}" "${extractDir}"`, { stdio: 'ignore' });
      const srcXkb = path.join(extractDir, 'usr', 'share', 'X11', 'xkb');
      fs.mkdirSync(path.dirname(XKB_DATA_DIR), { recursive: true });
      fs.cpSync(srcXkb, XKB_DATA_DIR, { recursive: true });
      try { fs.rmSync(tmpDeb, { force: true }); } catch { }
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { }
      log(`✅ xkb-data siap di ${XKB_DATA_DIR}`);
    } catch (e) {
      err(`Gagal install xkb-data: ${e.message}`);
    }
  }

  if (!fs.existsSync(XKBCOMP_VENDOR_PATH)) {
    try {
      log('Mengunduh xkbcomp (dari x11-xkb-utils)...');
      const tmpDeb = path.join(VENDOR_DIR, '_tmp_xkbutils.deb');
      const extractDir = path.join(VENDOR_DIR, '_extract_xkbutils');
      await download(XKB_UTILS_DEB_URL, tmpDeb);
      fs.mkdirSync(extractDir, { recursive: true });
      execSync(`dpkg-deb -x "${tmpDeb}" "${extractDir}"`, { stdio: 'ignore' });
      const srcBin = path.join(extractDir, 'usr', 'bin', 'xkbcomp');
      fs.copyFileSync(srcBin, XKBCOMP_VENDOR_PATH);
      try { fs.chmodSync(XKBCOMP_VENDOR_PATH, 0o755); } catch { }
      try { fs.rmSync(tmpDeb, { force: true }); } catch { }
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { }
      log(`✅ xkbcomp siap di ${XKBCOMP_VENDOR_PATH}`);
    } catch (e) {
      err(`Gagal install xkbcomp: ${e.message}`);
      return false;
    }
  }

  await ensureLibsFor(XKBCOMP_VENDOR_PATH);

  try {
    fs.mkdirSync(path.dirname(XKBCOMP_RUNTIME_PATH), { recursive: true });
    fs.copyFileSync(XKBCOMP_VENDOR_PATH, XKBCOMP_RUNTIME_PATH);
    try { fs.chmodSync(XKBCOMP_RUNTIME_PATH, 0o755); } catch { }
    log(`✅ xkbcomp siap di ${XKBCOMP_RUNTIME_PATH}`);
    return true;
  } catch (e) {
    err(`Gagal taruh xkbcomp di ${XKBCOMP_RUNTIME_PATH}: ${e.message}`);
    return false;
  }
}

async function installXvfb() {
  fs.mkdirSync(VENDOR_DIR, { recursive: true });

  log(`Mengunduh Xvfb binary dari Ubuntu mirror...`);
  await download(DEB_URL, DEB_PATH);

  const extractDir = path.join(VENDOR_DIR, '_extract');
  fs.mkdirSync(extractDir, { recursive: true });
  execSync(`dpkg-deb -x "${DEB_PATH}" "${extractDir}"`, { stdio: 'ignore' });

  const srcBin = path.join(extractDir, 'usr', 'bin', 'Xvfb');
  fs.copyFileSync(srcBin, BIN_PATH);
  try { fs.chmodSync(BIN_PATH, 0o755); } catch { }

  try { patchXkbcompPathInBinary(BIN_PATH); } catch (e) { }

  try {
    fs.copyFileSync(BIN_PATH, TMP_BIN);
    fs.chmodSync(TMP_BIN, 0o755);
  } catch { }

  try { fs.rmSync(DEB_PATH, { force: true }); } catch { }
  try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { }

  log(`✅ Xvfb binary siap: ${BIN_PATH}`);
}

async function _ensureXvfbInternal() {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return;
  }

  // 1. Cek jika DISPLAY sudah aktif
  if (process.env.DISPLAY) {
    const num = process.env.DISPLAY.replace(':', '');
    if (isDisplayUp(num)) {
      log(`DISPLAY=${process.env.DISPLAY} sudah aktif.`);
      _displayNum = num;
      return;
    }
  }

  // 2. Cek system Xvfb
  const systemXvfb = (() => {
    for (const p of ['/usr/bin/Xvfb', '/usr/local/bin/Xvfb']) {
      if (fileExists(p)) return p;
    }
    try { return execSync('which Xvfb 2>/dev/null', { encoding: 'utf8' }).trim() || null; }
    catch { return null; }
  })();

  const xvfbBin = systemXvfb || (fileExists(BIN_PATH) ? BIN_PATH : null);

  if (!xvfbBin) {
    log(`Xvfb tidak ditemukan di sistem, memulai instalasi otomatis (rootless deb extraction)...`);
    try {
      await installXvfb();
    } catch (e) {
      err(`Gagal install Xvfb: ${e.message}`);
      return;
    }
  } else {
    if (systemXvfb) log(`Menggunakan system Xvfb: ${systemXvfb}`);
    else log(`Menggunakan vendor Xvfb: ${BIN_PATH}`);
  }

  let finalBin;
  if (fileExists(TMP_BIN)) finalBin = TMP_BIN;
  else if (systemXvfb) finalBin = systemXvfb;
  else if (fileExists(BIN_PATH)) finalBin = BIN_PATH;
  else finalBin = TMP_BIN;

  const existingLdPath = process.env.LD_LIBRARY_PATH || '';
  if (!existingLdPath.split(':').includes(LIB_DIR)) {
    process.env.LD_LIBRARY_PATH = existingLdPath ? `${LIB_DIR}:${existingLdPath}` : LIB_DIR;
  }

  await ensureLibsFor(finalBin);
  await ensureXkb();

  try {
    if (!fs.existsSync('/tmp/.X11-unix')) {
      fs.mkdirSync('/tmp/.X11-unix', { recursive: true, mode: 0o1777 });
    }
    try { fs.chmodSync('/tmp/.X11-unix', 0o1777); } catch { }
  } catch (e) { }

  cleanupStaleLock(99);
  _displayNum = findFreeDisplay(99);

  log(`Memulai Xvfb display :${_displayNum}...`);
  _xvfbProc = spawn(finalBin, [
    `:${_displayNum}`,
    '-screen', '0', '1280x800x24',
    '-ac',
    '-nolisten', 'tcp',
    ...(fs.existsSync(XKB_DATA_DIR) ? ['-xkbdir', XKB_DATA_DIR] : []),
  ], { detached: false, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });

  _xvfbProc.on('error', (e) => {
    err(`Xvfb spawn error: ${e.message}`);
    _xvfbProc = null;
  });

  _xvfbProc.on('exit', (code) => {
    warn(`Xvfb exited dengan kode ${code}`);
    _xvfbProc = null;
  });

  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (isDisplayUp(_displayNum)) {
      process.env.DISPLAY = `:${_displayNum}`;
      log(`✅ Xvfb :${_displayNum} siap → DISPLAY=${process.env.DISPLAY}`);
      return;
    }
  }

  process.env.DISPLAY = `:${_displayNum}`;
  warn(`Display belum terkonfirmasi, set DISPLAY=${process.env.DISPLAY}`);
}

async function ensureXvfb() {
  if (_ensureXvfbInFlight) {
    return _ensureXvfbInFlight;
  }
  _ensureXvfbInFlight = _ensureXvfbInternal();
  try {
    return await _ensureXvfbInFlight;
  } finally {
    _ensureXvfbInFlight = null;
  }
}

function stopXvfb() {
  if (_xvfbProc) {
    try { _xvfbProc.kill(); } catch { }
    _xvfbProc = null;
    log('Xvfb dihentikan');
  }
}

for (const sig of ['exit', 'SIGINT', 'SIGTERM']) {
  process.on(sig, () => { stopXvfb(); if (sig !== 'exit') process.exit(0); });
}

module.exports = { ensureXvfb, stopXvfb };
