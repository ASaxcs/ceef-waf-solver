function solvePinjamIp({ url, proxy, method = "GET", postData, customHeaders }) {
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

      if (customHeaders && typeof customHeaders === "object") {
        await page.setExtraHTTPHeaders(customHeaders).catch(() => {});
      }

      // Step 1: Navigate to target URL to pass Cloudflare WAF on server's IP
      const initialResponse = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: global.timeOut || 60000,
      });

      // Wait for challenge solving
      await new Promise((r) => setTimeout(r, 4000));

      let attempts = 0;
      while (attempts < 4) {
        const title = await page.title().catch(() => "");
        const isChallenge =
          title.includes("Just a moment...") ||
          title.includes("Attention Required!");
        if (!isChallenge) break;
        await new Promise((r) => setTimeout(r, 2500));
        attempts++;
      }

      let responseData = null;
      let statusCode = initialResponse ? initialResponse.status() : 200;

      // Step 2: If method is POST or client requested custom request through the browser session (Pinjam IP)
      if (method.toUpperCase() === "POST" && postData) {
        console.log(`[Pinjam-IP] Executing POST request inside authenticated session for: ${url}`);
        responseData = await page.evaluate(
          async ({ reqUrl, reqBody, headers }) => {
            const res = await fetch(reqUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...headers,
              },
              body: typeof reqBody === "object" ? JSON.stringify(reqBody) : reqBody,
            });
            const text = await res.text();
            return {
              status: res.status,
              body: text,
            };
          },
          { reqUrl: url, reqBody: postData, headers: customHeaders || {} }
        );
        if (responseData) {
          statusCode = responseData.status;
          responseData = responseData.body;
        }
      } else {
        // GET request: Return the solved page content
        responseData = await page.content();
      }

      const cookies = await page.cookies();
      const userAgent = await page.evaluate(() => navigator.userAgent);
      const pageTitle = await page.title();
      const currentUrl = page.url();

      const cfClearanceCookie = cookies.find((c) => c.name === "cf_clearance");

      isResolved = true;
      clearInterval(cl);
      await context.close().catch(() => {});

      resolve({
        mode: "pinjam-ip",
        url: currentUrl,
        title: pageTitle,
        statusCode,
        cf_clearance: cfClearanceCookie ? cfClearanceCookie.value : null,
        response: responseData,
        cookies,
        headers: {
          "user-agent": userAgent,
        },
      });
    } catch (e) {
      if (!isResolved) {
        await context.close().catch(() => {});
        clearInterval(cl);
        reject(e.message);
      }
    }
  });
}

module.exports = solvePinjamIp;
