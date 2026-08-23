const solveTurnstileMin = require("./solveTurnstile.min");
const solveTurnstileMax = require("./solveTurnstile.max");

async function extractSiteKey(url, proxy, customHeaders) {
  return new Promise(async (resolve, reject) => {
    const context = await global.browser
      .createBrowserContext({
        proxyServer: proxy ? `http://${proxy.host}:${proxy.port}` : undefined,
      })
      .catch(() => null);

    if (!context) return reject("Failed to create browser context for siteKey scan");

    let detectedSiteKey = null;
    let isResolved = false;

    const cleanup = async () => {
      if (!isResolved) {
        isResolved = true;
        await context.close().catch(() => {});
      }
    };

    const timeoutTimer = setTimeout(async () => {
      await cleanup();
      if (detectedSiteKey) {
        resolve(detectedSiteKey);
      } else {
        reject("Timeout: Could not auto-detect siteKey from network or DOM");
      }
    }, 15000);

    try {
      const page = await context.newPage();

      if (proxy?.username && proxy?.password) {
        await page.authenticate({
          username: proxy.username,
          password: proxy.password,
        });
      }

      if (customHeaders && typeof customHeaders === "object") {
        await page.setExtraHTTPHeaders(customHeaders).catch(() => {});
      }

      // ── 1. Listen for Network Requests with SiteKey ──
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const reqUrl = req.url();

        // Pattern 1: challenges.cloudflare.com iframe / request with k= or sitekey=
        if (reqUrl.includes("challenges.cloudflare.com")) {
          const matchK = reqUrl.match(/[?&](?:k|sitekey)=([^&#]+)/i);
          if (matchK && matchK[1] && !detectedSiteKey) {
            detectedSiteKey = matchK[1];
          }
        }

        // Pattern 2: Cloudflare challenge platform endpoint (e.g. /turnstile/0.xxx/0x4AAAAAA... or 3x...)
        const match0x = reqUrl.match(/(0x4[A-Za-z0-9_-]{18,30}|[0-3]x[0-9a-zA-Z_-]{18,30})/);
        if (match0x && match0x[1] && !detectedSiteKey) {
          detectedSiteKey = match0x[1];
        }

        req.continue().catch(() => {});
      });

      // Navigate to target URL
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      }).catch(() => {});

      // ── 2. Scan DOM Elements and Scripts ──
      for (let i = 0; i < 6; i++) {
        if (detectedSiteKey) break;

        detectedSiteKey = await page.evaluate(() => {
          // Check data-sitekey attribute on widgets
          const widget = document.querySelector("[data-sitekey], .cf-turnstile, div[class*='turnstile']");
          if (widget) {
            const key = widget.getAttribute("data-sitekey") || widget.getAttribute("data-key");
            if (key) return key;
          }

          // Check iframes
          const iframes = Array.from(document.querySelectorAll("iframe"));
          for (const f of iframes) {
            const src = f.src || "";
            if (src.includes("challenges.cloudflare.com")) {
              const m = src.match(/[?&](?:k|sitekey)=([^&#]+)/i);
              if (m && m[1]) return m[1];
              const m0x = src.match(/(0x4[A-Za-z0-9_-]{18,30}|[0-3]x[0-9a-zA-Z_-]{18,30})/);
              if (m0x && m0x[1]) return m0x[1];
            }
          }

          // Check inline scripts
          const scripts = Array.from(document.querySelectorAll("script"));
          for (const s of scripts) {
            const text = s.innerText || s.textContent || "";
            const m = text.match(/['"](0x4[A-Za-z0-9_-]{18,30}|[0-3]x[0-9a-zA-Z_-]{18,30})['"]/);
            if (m && m[1]) return m[1];
          }

          return null;
        }).catch(() => null);

        if (detectedSiteKey) break;
        await new Promise((r) => setTimeout(r, 1000));
      }

      clearTimeout(timeoutTimer);
      await cleanup();

      if (detectedSiteKey) {
        console.log(`[Auto-Mode] Successfully extracted siteKey: ${detectedSiteKey}`);
        resolve(detectedSiteKey);
      } else {
        reject("Failed to auto-extract siteKey from target URL");
      }
    } catch (err) {
      clearTimeout(timeoutTimer);
      await cleanup();
      reject(err.message || "Error during siteKey extraction");
    }
  });
}

async function solveAuto({ url, proxy, siteKey, customHeaders }) {
  let targetSiteKey = siteKey;

  // Step 1: If siteKey not provided, auto-extract it by scanning network & DOM
  if (!targetSiteKey) {
    console.log(`[Auto-Mode] Loading ${url} to scan network and extract siteKey...`);
    targetSiteKey = await extractSiteKey(url, proxy, customHeaders);
  }

  // Step 2: Run main turnstile solver logic using url + extracted siteKey
  console.log(`[Auto-Mode] Running main Turnstile solver with SiteKey: ${targetSiteKey}`);
  const token = await solveTurnstileMin({
    url,
    proxy,
    siteKey: targetSiteKey,
  });

  return {
    mode: "auto",
    url,
    siteKey: targetSiteKey,
    token,
  };
}

module.exports = solveAuto;
