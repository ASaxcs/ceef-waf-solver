const { WebSocketServer, WebSocket } = require("ws");
const os = require("os");

const solveTurnstileMin = require("../endpoints/solveTurnstile.min");
const solveTurnstileMax = require("../endpoints/solveTurnstile.max");
const wafSession = require("../endpoints/wafSession");
const solveAuto = require("../endpoints/solveAuto");
const solvePinjamIp = require("../endpoints/solvePinjamIp");
const getSource = require("../endpoints/getSource");

function getSystemStats() {
  const totalMemMb = Math.round(os.totalmem() / 1024 / 1024);
  const freeMemMb = Math.round(os.freemem() / 1024 / 1024);
  const usedMemMb = totalMemMb - freeMemMb;
  return {
    memory: {
      totalMb: totalMemMb,
      usedMb: usedMemMb,
      freeMb: freeMemMb,
      usagePercent: Math.round((usedMemMb / totalMemMb) * 100),
    },
    activeJobs: global.browserLength || 0,
    browserReady: !!global.browser,
    uptimeSeconds: Math.round(process.uptime()),
  };
}

async function handleTask(data) {
  // Normalize siteKey parameter
  data.siteKey = data.siteKey || data.sitekey || data.site_key || null;

  let mode = data.mode;
  if (!mode) {
    if (data.siteKey) mode = "turnstile-min";
    else if (data.ipBound || data.method === "POST") mode = "pinjam-ip";
    else mode = "auto";
  }

  let result;
  switch (mode) {
    case "source":
      result = await getSource(data).then((res) => ({ source: res, content: res, code: 200 }));
      break;
    case "turnstile-min":
      result = await solveTurnstileMin(data).then((res) => ({ token: res, turnstileToken: res, code: 200 }));
      break;
    case "turnstile-max":
      result = await solveTurnstileMax(data).then((res) => ({ token: res, turnstileToken: res, code: 200 }));
      break;
    case "waf-session":
      result = await wafSession(data).then((res) => ({ ...res, code: 200 }));
      break;
    case "auto":
      result = await solveAuto(data).then((res) => ({ ...res, code: 200 }));
      break;
    case "pinjam-ip":
    case "ip-bound":
      result = await solvePinjamIp(data).then((res) => ({ ...res, code: 200 }));
      break;
    default:
      result = await solveAuto(data).then((res) => ({ ...res, code: 200 }));
      break;
  }

  // Ensure turnstileToken and cf_clearance compatibility for Master API
  if (result.token && !result.turnstileToken) result.turnstileToken = result.token;
  if (result.cookies && Array.isArray(result.cookies)) {
    const cf = result.cookies.find(c => c.name === 'cf_clearance');
    if (cf) result.cf_clearance = cf.value;
  }
  return result;
}

function initWebSocket(server) {
  // ── 1. Inbound WebSocket Server for Direct Client Connections ──
  const wss = new WebSocketServer({ server, path: "/ws" });
  console.log("⚡ [WS-Server] Inbound WebSocket endpoint ready at /ws");

  wss.on("connection", (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`🔌 [WS-Server] Client connected from ${clientIp}`);

    ws.send(
      JSON.stringify({
        type: "CONNECTED",
        message: "Connected to CEEF WAF Solver WebSocket Server",
        stats: getSystemStats(),
      })
    );

    ws.on("message", async (rawMessage) => {
      let msg;
      try {
        msg = JSON.parse(rawMessage);
      } catch (err) {
        return ws.send(JSON.stringify({ type: "ERROR", message: "Invalid JSON format" }));
      }

      // Heartbeat / Ping
      if (msg.type === "PING" || msg.type === "HEARTBEAT") {
        return ws.send(JSON.stringify({ type: "PONG", stats: getSystemStats() }));
      }

      // Solver Job Request
      const jobId = msg.id || `ws_${Date.now()}`;
      if (!msg.url && !msg.data?.url) {
        return ws.send(
          JSON.stringify({
            type: "JOB_RESULT",
            id: jobId,
            status: "error",
            error: "Missing required 'url' field",
          })
        );
      }

      if (!global.browser) {
        return ws.send(
          JSON.stringify({
            type: "JOB_RESULT",
            id: jobId,
            status: "error",
            error: "The scanner is not ready yet. Browser is initializing.",
          })
        );
      }

      try {
        global.browserLength++;
        ws.send(JSON.stringify({ type: "JOB_STATUS", id: jobId, status: "processing", message: "Solving challenge..." }));
        const taskPayload = msg.data || msg;
        const result = await handleTask(taskPayload);
        ws.send(JSON.stringify({ type: "JOB_RESULT", id: jobId, status: "success", code: 200, data: result }));
      } catch (err) {
        ws.send(JSON.stringify({ type: "JOB_RESULT", id: jobId, status: "error", code: 500, error: err.message || String(err) }));
      } finally {
        global.browserLength--;
      }
    });

    ws.on("close", () => {
      console.log(`🔌 [WS-Server] Client disconnected: ${clientIp}`);
    });
  });

  // ── 2. Outbound Worker Client to Main API Server (api.myxzlyn.my.id) ──
  const rawWsUrl = process.env.MAIN_WS_URL || process.env.MAIN_URL || "wss://api.myxzlyn.my.id/ws/cf-worker";
  
  if (process.env.DISABLE_MAIN_WS !== "true" && rawWsUrl) {
    let targetWsUrl = rawWsUrl.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
    if (!targetWsUrl.includes('/ws/cf-worker')) {
      if (!targetWsUrl.endsWith('/')) targetWsUrl += '/';
      targetWsUrl += 'ws/cf-worker';
    }

    const workerId = process.env.WORKER_ID || `ceef_ptero_${os.hostname() || Math.random().toString(36).substring(2, 7)}`;
    const workerSecret = process.env.APIKEY || process.env.API_KEY || process.env.WORKER_SECRET || "default_cf_worker_secret_2026";
    
    console.log(`📡 [WS-Worker] Outbound worker connecting to Main Server: ${targetWsUrl}`);

    function connectMain() {
      const sep = targetWsUrl.includes("?") ? "&" : "?";
      const fullUrl = `${targetWsUrl}${sep}secret=${encodeURIComponent(workerSecret)}&workerId=${encodeURIComponent(workerId)}`;
      
      const client = new WebSocket(fullUrl);
      let heartbeatTimer = null;

      client.on("open", () => {
        console.log(`✅ [WS-Worker] Successfully CONNECTED to Main Server (api.myxzlyn.my.id) as Worker: ${workerId}`);
        heartbeatTimer = setInterval(() => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "HEARTBEAT", workerId, stats: getSystemStats() }));
          } else {
            clearInterval(heartbeatTimer);
          }
        }, 15000);
      });

      client.on("message", async (raw) => {
        try {
          const msg = JSON.parse(raw);

          if (msg.type === "REGISTERED") {
            console.log(`🎉 [WS-Worker] Registered successfully on Master Server! WorkerID: ${msg.workerId || workerId}`);
            return;
          }

          if (msg.type === "AUTH_FAILED") {
            console.error(`❌ [WS-Worker] Auth failed on Main Server: ${msg.message}`);
            return;
          }

          if (msg.type === "JOB") {
            const { id, data } = msg;
            console.log(`📥 [WS-Worker] Received JOB from Server: id=${id} | url=${data?.url || data?.mode}`);
            global.browserLength++;
            try {
              const result = await handleTask(data || {});
              client.send(JSON.stringify({
                type: "JOB_RESULT",
                id,
                status: "success",
                data: result
              }));
              console.log(`📤 [WS-Worker] Sent JOB_RESULT success for id=${id}`);
            } catch (err) {
              console.error(`❌ [WS-Worker] Job ${id} failed:`, err.message);
              client.send(JSON.stringify({
                type: "JOB_RESULT",
                id,
                status: "error",
                error: err.message || String(err)
              }));
            } finally {
              global.browserLength--;
            }
          }
        } catch (e) {
          console.error(`[WS-Worker] Message parse error:`, e.message);
        }
      });

      client.on("close", (code, reason) => {
        console.log(`⚠️ [WS-Worker] Disconnected from Main Server (Code: ${code}). Reconnecting in 5s...`);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        setTimeout(connectMain, 5000);
      });

      client.on("error", (e) => {
        console.error("❌ [WS-Worker] Socket error:", e.message);
      });
    }

    connectMain();
  }
}

module.exports = { initWebSocket, handleTask };
