# 💻 Panduan & Contoh Kode Klien (Multi-Language SDK & Examples)

Dokumen ini menyediakan implementasi kode siap pakai (*copy-paste ready*) dalam berbagai bahasa pemrograman (**JavaScript/Node.js, Python, Go, dan cURL/Bash**) untuk mengintegrasikan aplikasi Anda dengan **CEEF WAF Solver**.

---

## 📑 Daftar Isi
1. [Node.js / JavaScript](#1-nodejs--javascript)
   - [A. Native Fetch (Solve Turnstile Auto)](#a-native-fetch-solve-turnstile-auto)
   - [B. Axios Client dengan Proxy & Error Handling](#b-axios-client-dengan-proxy--error-handling)
   - [C. Integrasi CycleTLS (JA3 Fingerprint Matcher)](#c-integrasi-cycletls-ja3-fingerprint-matcher)
   - [D. Mode Pinjam-IP (POST Request Tunneling)](#d-mode-pinjam-ip-post-request-tunneling)
   - [E. WebSocket Client Real-time (`ws`)](#e-websocket-client-real-time-ws)
2. [Python](#2-python)
   - [A. Standard Requests & Httpx](#a-standard-requests--httpx)
   - [B. Integrasi `tls-client` / `curl_cffi` (Chrome JA3 Fingerprint)](#b-integrasi-tls-client--curl_cffi-chrome-ja3-fingerprint)
   - [C. Async WebSocket Client (`websockets`)](#c-async-websocket-client-websockets)
3. [Go (Golang)](#3-go-golang)
   - [A. Standard `net/http` JSON Client](#a-standard-nethttp-json-client)
   - [B. `bogdanfinn/tls-client` Implementation](#b-bogdanfinntls-client-implementation)
4. [cURL & Bash CLI](#4-curl--bash-cli)

---

## 1. Node.js / JavaScript

### A. Native Fetch (Solve Turnstile Auto)
```javascript
// solve-turnstile-auto.js
async function solveTurnstile() {
  const solverEndpoint = "http://localhost:7860/cf-clearance-scraper";
  const targetUrl = "https://turnstile.zeroclover.io/";

  try {
    console.log("⏳ Mengirim permintaan penyelesaian Turnstile ke CEEF...");
    const response = await fetch(solverEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "auto",
        url: targetUrl,
        // authToken: "rahasia123" // Aktifkan jika server menggunakan authToken
      }),
    });

    const result = await response.json();
    if (result.code === 200 && result.token) {
      console.log("✅ Token Turnstile Berhasil Didapatkan!");
      console.log("SiteKey:", result.siteKey);
      console.log("Token:", result.token);
      return result.token;
    } else {
      console.error("❌ Gagal menyelesaikan Turnstile:", result);
    }
  } catch (error) {
    console.error("❌ Error koneksi ke server solver:", error.message);
  }
}

solveTurnstile();
```

---

### B. Axios Client dengan Proxy & Error Handling
```javascript
// axios-scraper.js
const axios = require("axios");

async function scrapeWithProxy() {
  try {
    const payload = {
      mode: "source",
      url: "https://nopecha.com/demo/cloudflare",
      proxy: {
        host: "103.145.22.10",
        port: 8080,
        username: "proxyuser",
        password: "proxypassword",
      },
    };

    const res = await axios.post("http://localhost:7860/cf-clearance-scraper", payload, {
      timeout: 90000,
    });

    if (res.data.code === 200) {
      console.log("✅ Berhasil scrape HTML!");
      console.log("Panjang HTML:", res.data.source.length, "karakter");
    }
  } catch (err) {
    if (err.response) {
      console.error(`❌ HTTP Error [${err.response.status}]:`, err.response.data);
    } else {
      console.error("❌ Network Error:", err.message);
    }
  }
}

scrapeWithProxy();
```

---

### C. Integrasi CycleTLS (JA3 Fingerprint Matcher)
Teknik ini mengekstrak sesi WAF dari CEEF lalu mengirimkan ribuan request menggunakan CycleTLS tanpa membuka browser lagi.

```javascript
// cycletls-session-client.js
const initCycleTLS = require("cycletls");

async function runHighSpeedSession() {
  const solverUrl = "http://localhost:7860/cf-clearance-scraper";
  const targetSite = "https://nopecha.com/demo/cloudflare";

  console.log("1. Mengambil sesi WAF & cookie clearance dari CEEF...");
  const sessionRes = await fetch(solverUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "waf-session",
      url: targetSite,
    }),
  });

  const session = await sessionRes.json();
  if (session.code !== 200 || !session.cookies) {
    throw new Error("Gagal mengambil sesi: " + JSON.stringify(session));
  }

  // Format cookie string: "cf_clearance=...; __cf_bm=..."
  const cookieHeader = session.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  console.log("2. Inisialisasi CycleTLS dengan JA3 Chrome Fingerprint...");
  const cycleTLS = await initCycleTLS();

  // JA3 Signature resmi Google Chrome v120+
  const ja3Fingerprint =
    "772,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,23-27-65037-43-51-45-16-11-13-17513-5-18-65281-0-10-35,25497-29-23-24,0";

  const response = await cycleTLS(
    targetSite,
    {
      body: "",
      ja3: ja3Fingerprint,
      userAgent: session.headers["user-agent"],
      headers: {
        ...session.headers,
        cookie: cookieHeader,
      },
    },
    "get"
  );

  console.log("✅ Respon Status dari Target:", response.status);
  console.log("✅ Respon Body Length:", response.body.length);

  await cycleTLS.exit();
}

runHighSpeedSession().catch(console.error);
```

---

### D. Mode Pinjam-IP (POST Request Tunneling)
```javascript
// pinjam-ip-client.js
async function postViaServerSession() {
  const targetApi = "https://example.com/api/v1/checkout";

  const response = await fetch("http://localhost:7860/cf-clearance-scraper", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "pinjam-ip",
      url: targetApi,
      method: "POST",
      postData: {
        item_id: "SKU-9921",
        quantity: 1,
        promo: "DISCOUNT50",
      },
      customHeaders: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
    }),
  });

  const data = await response.json();
  console.log("✅ Status Code Target:", data.statusCode);
  console.log("✅ Cookie cf_clearance:", data.cf_clearance);
  console.log("✅ Respon Data API:", data.response);
}

postViaServerSession();
```

---

### E. WebSocket Client Real-time (`ws`)
```javascript
// ws-client.js
const WebSocket = require("ws");

const ws = new WebSocket("ws://localhost:7860/ws");

ws.on("open", () => {
  console.log("⚡ Terhubung ke CEEF WebSocket Server");

  // 1. Kirim PING untuk cek status sistem
  ws.send(JSON.stringify({ type: "PING" }));

  // 2. Kirim tugas solving
  const job = {
    id: "job_realtime_01",
    mode: "auto",
    url: "https://turnstile.zeroclover.io/",
  };

  console.log("📤 Mengirim Job:", job.id);
  ws.send(JSON.stringify(job));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw);

  if (msg.type === "PONG") {
    console.log("📊 Telemetri Server:", msg.stats);
  } else if (msg.type === "JOB_STATUS") {
    console.log(`⏳ Status Job [${msg.id}]:`, msg.status, msg.message);
  } else if (msg.type === "JOB_RESULT") {
    console.log(`🎉 Hasil Job [${msg.id}]:`, msg.data || msg.error);
    ws.close();
  }
});
```

---

## 2. Python

### A. Standard Requests & Httpx
```python
# solve_turnstile.py
import requests

SOLVER_ENDPOINT = "http://localhost:7860/cf-clearance-scraper"
TARGET_URL = "https://turnstile.zeroclover.io/"

payload = {
    "mode": "auto",
    "url": TARGET_URL
}

try:
    response = requests.post(SOLVER_ENDPOINT, json=payload, timeout=90)
    response.raise_for_status()
    data = response.json()
    
    if data.get("code") == 200:
        print(f"✅ Token Turnstile: {data.get('token')}")
        print(f"✅ Extracted SiteKey: {data.get('siteKey')}")
    else:
        print(f"❌ Gagal: {data}")
except Exception as e:
    print(f"❌ Error: {e}")
```

---

### B. Integrasi `tls-client` / `curl_cffi` (Chrome JA3 Fingerprint)
```python
# tls_client_session.py
import requests
import tls_client

SOLVER_URL = "http://localhost:7860/cf-clearance-scraper"
TARGET_SITE = "https://nopecha.com/demo/cloudflare"

# 1. Dapatkan Sesi dari CEEF Solver
print("1. Mengambil sesi WAF dari CEEF...")
res = requests.post(SOLVER_URL, json={"mode": "waf-session", "url": TARGET_SITE})
session_data = res.json()

if session_data.get("code") != 200:
    raise Exception(f"Gagal memperoleh sesi: {session_data}")

# 2. Buat TLS Client Session dengan impersonate browser Chrome asli
session = tls_client.Session(
    client_identifier="chrome_120",
    random_tls_extension_order=True
)

# Masukkan cookies yang didapat dari solver
for cookie in session_data.get("cookies", []):
    session.cookies.set(cookie["name"], cookie["value"], domain=cookie.get("domain", ""))

# Masukkan headers
headers = session_data.get("headers", {})
session.headers.update(headers)

# 3. Kirim request berkecepatan tinggi tanpa terblokir Cloudflare!
print("2. Mengirim request berkecepatan tinggi via tls-client...")
response = session.get(TARGET_SITE)
print(f"✅ Status Code: {response.status_code}")
print(f"✅ Response Preview: {response.text[:300]}...")
```

---

### C. Async WebSocket Client (`websockets`)
```python
# async_ws_client.py
import asyncio
import json
import websockets

async def solve_via_websocket():
    uri = "ws://localhost:7860/ws"
    async with websockets.connect(uri) as ws:
        # Sambutan awal
        greeting = await ws.recv()
        print("Server Telemetry:", json.loads(greeting))

        # Kirim Job
        job_payload = {
            "id": "py_job_001",
            "mode": "auto",
            "url": "https://turnstile.zeroclover.io/"
        }
        await ws.send(json.dumps(job_payload))

        while True:
            msg_raw = await ws.recv()
            msg = json.loads(msg_raw)
            if msg.get("type") == "JOB_STATUS":
                print(f"⏳ Job Progress: {msg.get('status')}")
            elif msg.get("type") == "JOB_RESULT":
                print("🎉 Job Selesai!")
                print(json.dumps(msg, indent=2))
                break

asyncio.run(solve_via_websocket())
```

---

## 3. Go (Golang)

### A. Standard `net/http` JSON Client
```go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type SolverRequest struct {
	Mode string `json:"mode"`
	URL  string `json:"url"`
}

type SolverResponse struct {
	Code    int    `json:"code"`
	Mode    string `json:"mode"`
	SiteKey string `json:"siteKey"`
	Token   string `json:"token"`
	Message string `json:"message"`
}

func main() {
	client := &http.Client{Timeout: 90 * time.Second}

	reqBody, _ := json.Marshal(SolverRequest{
		Mode: "auto",
		URL:  "https://turnstile.zeroclover.io/",
	})

	resp, err := client.Post("http://localhost:7860/cf-clearance-scraper", "application/json", bytes.NewBuffer(reqBody))
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var result SolverResponse
	json.Unmarshal(body, &result)

	if result.Code == 200 {
		fmt.Printf("✅ Token Turnstile Berhasil Didapatkan: %s\n", result.Token)
	} else {
		fmt.Printf("❌ Gagal: %s\n", result.Message)
	}
}
```

---

## 4. cURL & Bash CLI

### A. Scrape HTML Source
```bash
curl -X POST http://localhost:7860/cf-clearance-scraper \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "source",
    "url": "https://nopecha.com/demo/cloudflare"
  }'
```

### B. Auto Solve Turnstile
```bash
curl -X POST http://localhost:7860/cf-clearance-scraper \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "auto",
    "url": "https://turnstile.zeroclover.io/"
  }'
```

### C. Pinjam-IP POST Request
```bash
curl -X POST http://localhost:7860/cf-clearance-scraper \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "pinjam-ip",
    "url": "https://httpbin.org/post",
    "method": "POST",
    "postData": {"hello": "world"}
  }'
```
