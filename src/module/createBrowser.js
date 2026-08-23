const { connect } = require("puppeteer-real-browser")
const getChromePath = require("./getChromePath")
const { ensureXvfb } = require("./xvfbManager")

async function createBrowser() {
    try {
        if (global.finished == true) return

        global.browser = null

        // 1. Ensure Xvfb and all required system / shared libraries exist
        await ensureXvfb();

        // 2. Ensure Chromium binary is available
        const executablePath = await getChromePath();

        if (executablePath) {
            process.env.CHROME_PATH = executablePath;
            process.env.CHROME_BIN = executablePath;
            process.env.PUPPETEER_EXECUTABLE_PATH = executablePath;
        }

        const options = {
            headless: false,
            turnstile: true,
            connectOption: { defaultViewport: null },
            disableXvfb: !!process.env.DISPLAY,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote'
            ]
        };

        if (executablePath) {
            options.customConfig = { chromePath: executablePath, executablePath: executablePath };
            options.executablePath = executablePath;
        }

        const { browser } = await connect(options);

        global.browser = browser;

        browser.on('disconnected', async () => {
            if (global.finished == true) return
            console.log('Browser disconnected');
            await new Promise(resolve => setTimeout(resolve, 3000));
            await createBrowser();
        })

    } catch (e) {
        console.log('[Browser Launcher Error]:', e.message);
        if (global.finished == true) return
        await new Promise(resolve => setTimeout(resolve, 3000));
        await createBrowser();
    }
}
createBrowser()