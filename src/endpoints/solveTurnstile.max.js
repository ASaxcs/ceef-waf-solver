function solveTurnstileMax({ url, proxy }) {
  return new Promise(async (resolve, reject) => {
    if (!url) return reject("Missing url parameter");

    const context = await global.browser
      .createBrowserContext({
        proxyServer: proxy ? `http://${proxy.host}:${proxy.port}` : undefined,
      })
      .catch(() => null);

    if (!context) return reject("Failed to create browser context");

    let isResolved = false;

    const cl = setTimeout(async () => {
      if (!isResolved) {
        await context.close().catch(() => {});
        reject("Timeout Error");
      }
    }, global.timeOut || 60000);

    try {
      const page = await context.newPage();

      if (proxy?.username && proxy?.password) {
        await page.authenticate({
          username: proxy.username,
          password: proxy.password,
        });
      }

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });

      // Poll for Turnstile token extraction
      let token = null;
      for (let i = 0; i < 60; i++) {
        token = await page.evaluate(() => {
          // 1. Native Turnstile response input
          const el = document.querySelector(
            '[name="cf-turnstile-response"], [name="cf-response"], textarea[name="cf-turnstile-response"], input[name="g-recaptcha-response"]'
          );
          if (el && el.value && el.value.length > 20) {
            return el.value;
          }

          // 2. Global window.turnstile API
          if (window.turnstile && typeof window.turnstile.getResponse === "function") {
            try {
              const res = window.turnstile.getResponse();
              if (res && res.length > 20) return res;
            } catch (_) {}
          }

          // 3. Fallback: scan all inputs for token signatures
          const inputs = Array.from(document.querySelectorAll("input, textarea"));
          for (const inp of inputs) {
            if (inp.value && (inp.value.startsWith("0.") || inp.value.startsWith("1.") || inp.value.startsWith("0x")) && inp.value.length > 50) {
              return inp.value;
            }
          }

          return null;
        }).catch(() => null);

        if (token) break;
        await new Promise((r) => setTimeout(r, 500));
      }

      isResolved = true;
      clearInterval(cl);
      await context.close().catch(() => {});

      if (!token || token.length < 10) return reject("Failed to get token");
      return resolve(token);
    } catch (e) {
      if (!isResolved) {
        await context.close().catch(() => {});
        clearInterval(cl);
        reject(e.message);
      }
    }
  });
}

module.exports = solveTurnstileMax;
