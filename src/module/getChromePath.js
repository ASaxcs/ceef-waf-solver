const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function findBinaryRecursively(dir, binaryNames) {
    if (!fs.existsSync(dir)) return null;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const found = findBinaryRecursively(fullPath, binaryNames);
                if (found) return found;
            } else if (entry.isFile()) {
                if (binaryNames.includes(entry.name)) {
                    return fullPath;
                }
            }
        }
    } catch (e) {}
    return null;
}

async function getChromePath() {
    // 1. Check explicit environment variables
    const envPath = process.env.CHROME_BIN || process.env.CHROME_PATH;
    if (envPath && fs.existsSync(envPath)) {
        console.log(`[Browser] Using environment Chrome path: ${envPath}`);
        process.env.CHROME_PATH = envPath;
        process.env.CHROME_BIN = envPath;
        process.env.PUPPETEER_EXECUTABLE_PATH = envPath;
        return envPath;
    }

    const binaryNames = process.platform === 'win32'
        ? ['chrome.exe', 'chromium.exe']
        : ['chrome', 'chromium', 'chromium-browser', 'chrome-headless-shell'];

    // 2. Check standard system locations
    const systemLocations = process.platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
        ]
        : [
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/snap/bin/chromium'
        ];

    for (const loc of systemLocations) {
        if (loc && fs.existsSync(loc)) {
            console.log(`[Browser] Detected system Chrome: ${loc}`);
            process.env.CHROME_PATH = loc;
            process.env.CHROME_BIN = loc;
            process.env.PUPPETEER_EXECUTABLE_PATH = loc;
            return loc;
        }
    }

    // 3. Check local cache and project folders
    const homeDir = process.env.HOME || process.env.USERPROFILE || '/home/container';
    const searchDirs = [
        path.resolve('./browsers'),
        path.resolve('/home/container/browsers'),
        path.resolve('./vendor/chrome'),
        path.resolve('/home/container/vendor/chrome'),
        path.join(homeDir, '.cache/puppeteer'),
        path.resolve('./node_modules/puppeteer/.local-chromium')
    ];

    for (const dir of searchDirs) {
        const found = findBinaryRecursively(dir, binaryNames);
        if (found) {
            console.log(`[Browser] Detected cached Chrome: ${found}`);
            try {
                if (process.platform === 'linux') fs.chmodSync(found, 0o755);
            } catch (_) {}
            process.env.CHROME_PATH = found;
            process.env.CHROME_BIN = found;
            process.env.PUPPETEER_EXECUTABLE_PATH = found;
            return found;
        }
    }

    // 4. Auto-download Chrome if not found anywhere
    console.log('[Browser] Chrome not found in system or cache. Auto-installing via @puppeteer/browsers...');
    try {
        const installDir = path.resolve('./browsers');
        if (!fs.existsSync(installDir)) {
            fs.mkdirSync(installDir, { recursive: true });
        }
        execSync(`npx @puppeteer/browsers install chrome@stable --path "${installDir}"`, {
            stdio: 'inherit'
        });
        const downloaded = findBinaryRecursively(installDir, binaryNames);
        if (downloaded) {
            console.log(`[Browser] Chrome successfully installed to: ${downloaded}`);
            process.env.CHROME_PATH = downloaded;
            process.env.CHROME_BIN = downloaded;
            process.env.PUPPETEER_EXECUTABLE_PATH = downloaded;
            return downloaded;
        }
    } catch (err) {
        console.error('[Browser] Failed to auto-install Chrome:', err.message);
    }

    return null;
}

module.exports = getChromePath;
