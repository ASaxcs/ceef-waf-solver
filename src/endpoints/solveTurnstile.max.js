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

      // Poll for Turnstile token or cf_clearance extraction
      let token = null;
      let cfClearance = null;
      let finalCookies = [];
      let pageTitle = "";

      for (let i = 0; i < 60; i++) {
        // 1. Check cookies for cf_clearance
        finalCookies = await page.cookies().catch(() => []);
        cfClearance = finalCookies.find((c) => c.name === "cf_clearance")?.value || null;
        pageTitle = await page.title().catch(() => "");

        // 2. Check DOM for Turnstile token
        token = await page
          .evaluate(() => {
            // 2.1 Native Turnstile response inputs
            const el = document.querySelector(
              '[name="cf-turnstile-response"], [name="cf-response"], textarea[name="cf-turnstile-response"], input[name="g-recaptcha-response"]'
            );
            if (el && el.value && el.value.length > 20) {
              return el.value;
            }

            // 2.2 Global window.turnstile API
            if (window.turnstile && typeof window.turnstile.getResponse === "function") {
              try {
                const res = window.turnstile.getResponse();
                if (res && res.length > 20) return res;
              } catch (_) {}
            }

            // 2.3 Fallback: scan all inputs for token signatures
            const inputs = Array.from(document.querySelectorAll("input, textarea"));
            for (const inp of inputs) {
              if (
                inp.value &&
                (inp.value.startsWith("0.") || inp.value.startsWith("1.") || inp.value.startsWith("0x")) &&
                inp.value.length > 50
              ) {
                return inp.value;
              }
            }

            return null;
          })
          .catch(() => null);

        const isChallengeFinished =
          (token && token.length > 10) ||
          cfClearance ||
          (!pageTitle.includes("Just a moment") &&
            !pageTitle.includes("Attention Required") &&
            !pageTitle.includes("Cloudflare Verification") &&
            pageTitle.length > 0 &&
            finalCookies.length > 0);

        if (isChallengeFinished) {
          break;
        }

        await new Promise((r) => setTimeout(r, 500));
      }

      isResolved = true;
      clearTimeout(cl);
      const finalUrl = page.url();
      await context.close().catch(() => {});

      const resultToken = token || cfClearance;
      if (!resultToken && !finalCookies.length) {
        return reject(new Error("Failed to get token or clearance cookie"));
      }

      return resolve({
        token: resultToken,
        turnstileToken: token,
        cf_clearance: cfClearance,
        cookies: finalCookies,
        title: pageTitle,
        url: finalUrl,
      });
    } catch (e) {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(cl);
        await context.close().catch(() => {});
        reject(e?.message ? e : new Error(String(e || "Turnstile-max solving failed")));
      }
    }
  });
}

module.exports = solveTurnstileMax;
