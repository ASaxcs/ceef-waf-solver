# 📚 Referensi API Lengkap (HTTP REST & WebSocket RPC)

Dokumen ini menyediakan spesifikasi teknis lengkap untuk semua antarmuka komunikasi yang didukung oleh **CEEF WAF Solver**, mencakup format request, parameter, aturan validasi skema Ajv, respon sukses, dan kode error.

---

## 📑 Daftar Isi
1. [Standar & Konvensi](#1-standar--konvensi)
2. [HTTP REST API](#2-http-rest-api)
   - [Endpoint 1: Health Check (`GET /`)](#endpoint-1-health-check-get-)
   - [Endpoint 2: Solver Gateway (`POST /cf-clearance-scraper`)](#endpoint-2-solver-gateway-post-cf-clearance-scraper)
3. [Skema Request & Validasi Parameter](#3-skema-request--validasi-parameter)
4. [Respon Berdasarkan Mode](#4-respon-berdasarkan-mode)
   - [Mode `source`](#mode-source)
   - [Mode `turnstile-min`](#mode-turnstile-min)
   - [Mode `turnstile-max`](#mode-turnstile-max)
   - [Mode `waf-session`](#mode-waf-session)
   - [Mode `auto`](#mode-auto)
   - [Mode `pinjam-ip` / `ip-bound`](#mode-pinjam-ip--ip-bound)
5. [Spesifikasi Error Codes HTTP](#5-spesifikasi-error-codes-http)
6. [Protokol WebSocket Inbound (`/ws`)](#6-protokol-websocket-inbound-ws)
7. [Protokol WebSocket Worker Terdistribusi](#7-protokol-websocket-worker-terdistribusi)

---

## 1. Standar & Konvensi

- **Base URL HTTP**: `http://<HOST>:<PORT>` (Default port: `7860` atau disesuaikan melalui environment variable `PORT` / `SERVER_PORT`).
- **Content-Type**: Selalu gunakan `application/json; charset=utf-8` untuk seluruh request POST.
- **WebSocket Endpoint**: `ws://<HOST>:<PORT>/ws`.
- **Batas Ukuran Payload**: Maksimal 10MB (`bodyParser.json({ limit: '10mb' })`).
- **Sistem Autentikasi**: Jika environment variable `authToken` diset pada server, seluruh request wajib menyertakan field `"authToken": "<TOKEN>"` di dalam JSON body.

---

## 2. HTTP REST API

### Endpoint 1: Health Check (`GET /`)
Mengembalikan status kesiapan browser, telemetri proses, dan daftar mode yang didukung.

**Request:**
```http
GET / HTTP/1.1
Host: localhost:7860
```

**Respon Sukses (`200 OK`):**
```json
{
  "status": true,
  "message": "CEEF WAF Solver is running (HTTP + WebSocket enabled)",
  "port": 7860,
  "wsEndpoint": "ws://host:7860/ws",
  "browserReady": true,
  "activeJobs": 0,
  "supportedModes": [
    "source",
    "turnstile-min",
    "turnstile-max",
    "waf-session",
    "auto",
    "pinjam-ip"
  ]
}
```

---

### Endpoint 2: Solver Gateway (`POST /cf-clearance-scraper`)
Pintu gerbang utama untuk mengeksekusi semua varian solving dan scraping.

**Request Header:**
```http
POST /cf-clearance-scraper HTTP/1.1
Host: localhost:7860
Content-Type: application/json
```

**Format Request Body Umum:**
```json
{
  "mode": "auto",
  "url": "https://example.com/protected-page",
  "authToken": "rahasia123",
  "siteKey": "0x4AAAAAAAEwzhD6pyKkgXC0",
  "proxy": {
    "host": "127.0.0.1",
    "port": 8080,
    "username": "user",
    "password": "pass"
  },
  "method": "GET",
  "postData": {
    "query": "data"
  },
  "customHeaders": {
    "User-Agent": "Mozilla/5.0 ...",
    "X-Custom-Header": "CEEF"
  }
}
```

---

## 3. Skema Request & Validasi Parameter

Backend menggunakan library **Ajv** dengan format validator `ajv-formats`. Aturan validasi didefinisikan sebagai berikut:

| Parameter | Tipe Data | Wajib? | Deskripsi & Aturan |
| :--- | :--- | :--- | :--- |
| `mode` | `string` | **Ya** | Harus salah satu dari: `["source", "turnstile-min", "turnstile-max", "waf-session", "auto", "pinjam-ip", "ip-bound"]`. |
| `url` | `string` | **Ya** | Harus berupa format URI yang valid (diawali dengan `http://` atau `https://`). |
| `authToken` | `string` | *Opsional* | Diperlukan jika server memiliki konfigurasi environment `authToken`. |
| `siteKey` | `string` | *Kondisional* | **Wajib** untuk `turnstile-min`. *Opsional* untuk `auto` (jika tidak diisi, akan di-scan otomatis). |
| `proxy` | `object` | *Opsional* | Konfigurasi upstream HTTP proxy. Tidak boleh menerima properti tambahan (*additionalProperties: false*). |
| `proxy.host` | `string` | **Ya** (jika proxy ada) | Alamat IP atau hostname proxy server. |
| `proxy.port` | `integer`| **Ya** (jika proxy ada) | Nomor port proxy server (angka integer). |
| `proxy.username` | `string` | *Opsional* | Username autentikasi proxy. |
| `proxy.password` | `string` | *Opsional* | Password autentikasi proxy. |
| `method` | `string` | *Opsional* | Metode HTTP (khusus `pinjam-ip`, default: `"GET"`). |
| `postData` | `object` / `string` | *Opsional* | Payload POST data saat menggunakan mode `pinjam-ip`. |
| `customHeaders` | `object` | *Opsional* | Key-value dictionary header tambahan yang diinjeksikan ke browser page. |

---

## 4. Respon Berdasarkan Mode

### Mode `source`
Mengekstrak seluruh isi kode sumber HTML setelah lolos validasi WAF / Challenge Cloudflare.

**Contoh Respon (`200 OK`):**
```json
{
  "code": 200,
  "source": "<!DOCTYPE html><html lang=\"en\"><head><title>Dashboard</title>...</head><body><h1>Welcome</h1></body></html>"
}
```

---

### Mode `turnstile-min`
Menghasilkan token Cloudflare Turnstile menggunakan injeksi template virtual DOM yang sangat ringan.

**Contoh Respon (`200 OK`):**
```json
{
  "code": 200,
  "token": "0.19n3F...a8ZqW9mQ_XQ2V"
}
```

---

### Mode `turnstile-max`
Menghasilkan token Cloudflare Turnstile dengan menavigasi situs target secara utuh dan mem-polling nilai token dari DOM/API widget.

**Contoh Respon (`200 OK`):**
```json
{
  "code": 200,
  "token": "0.98aX1...b4KpL0vC_MN5R"
}
```

---

### Mode `waf-session`
Menghasilkan cookies sesi Cloudflare yang valid (termasuk `cf_clearance`) dan header pendamping yang cocok untuk dipasangkan ke engine TLS client.

**Contoh Respon (`200 OK`):**
```json
{
  "code": 200,
  "cookies": [
    {
      "name": "cf_clearance",
      "value": "7z91kLPqW2N8e1m...",
      "domain": ".example.com",
      "path": "/",
      "expires": 1787491200,
      "httpOnly": true,
      "secure": true,
      "sameSite": "None"
    },
    {
      "name": "__cf_bm",
      "value": "a1b2c3d4...",
      "domain": ".example.com",
      "path": "/",
      "expires": 1755964800,
      "httpOnly": true,
      "secure": true,
      "sameSite": "None"
    }
  ],
  "headers": {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "accept-language": "en-US,en;q=0.9,id;q=0.8"
  }
}
```

---

### Mode `auto`
Melakukan pemindaian otomatis terhadap `siteKey` di halaman target melalui network interception dan analisis DOM/Script, kemudian langsung menyelesaikan Turnstile tanpa perlu input manual `siteKey`.

**Contoh Respon (`200 OK`):**
```json
{
  "code": 200,
  "mode": "auto",
  "url": "https://turnstile.zeroclover.io/",
  "siteKey": "0x4AAAAAAAEwzhD6pyKkgXC0",
  "token": "0.41bN9...x9ZvL2mP_KL0Q"
}
```

---

### Mode `pinjam-ip` / `ip-bound`
Mengeksekusi request HTTP langsung di dalam sesi browser yang terautentikasi pada IP server CEEF. Sangat ampuh untuk melewati proteksi Cloudflare tingkat lanjut yang mengikat cookie `cf_clearance` secara ketat ke IP originating.

**Contoh Respon (`200 OK`):**
```json
{
  "code": 200,
  "mode": "pinjam-ip",
  "url": "https://example.com/api/v1/protected-data",
  "title": "API Dashboard Protected",
  "statusCode": 200,
  "cf_clearance": "9xL1k0P2...w8ZmN1",
  "response": "{\"status\":\"success\",\"data\":[{\"id\":1,\"name\":\"Item Alpha\"}]}",
  "cookies": [
    {
      "name": "cf_clearance",
      "value": "9xL1k0P2...w8ZmN1"
    }
  ],
  "headers": {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36..."
  }
}
```

---

## 5. Spesifikasi Error Codes HTTP

CEEF menggunakan standar HTTP Status Codes berikut:

| HTTP Code | Error Name | Skenario Penyebab | Struktur Respon JSON |
| :--- | :--- | :--- | :--- |
| **`400`** | **Bad Request** | Skema JSON tidak valid, field `mode` / `url` hilang, format URL salah, atau properti tambahan tidak diizinkan. | `{"code": 400, "message": "Bad Request", "schema": [...]}` |
| **`401`** | **Unauthorized** | Server mengaktifkan `authToken`, namun request tidak menyertakan `authToken` yang cocok. | `{"code": 401, "message": "Unauthorized"}` |
| **`404`** | **Not Found** | Endpoint atau path HTTP yang dituju tidak terdaftar di router server. | `{"code": 404, "message": "Not Found"}` |
| **`429`** | **Too Many Requests** | Jumlah antrean browser context aktif telah mencapai batas maksimal (`browserLimit`). | `{"code": 429, "message": "Too Many Requests"}` |
| **`500`** | **Internal Server Error** | Timeout saat menyelesaikan challenge, Chromium crash, atau browser utama belum selesai inisialisasi. | `{"code": 500, "message": "Timeout Error"}` |

---

## 6. Protokol WebSocket Inbound (`/ws`)

Klien dapat membuka koneksi persistent WebSocket ke `ws://<HOST>:<PORT>/ws` untuk eksekusi real-time.

### A. Handshake & Telemetri Awal
Saat koneksi berhasil dibuka, server secara otomatis mengirimkan payload sambutan:
```json
{
  "type": "CONNECTED",
  "message": "Connected to CEEF WAF Solver WebSocket Server",
  "stats": {
    "memory": {
      "totalMb": 4096,
      "usedMb": 1280,
      "freeMb": 2816,
      "usagePercent": 31
    },
    "activeJobs": 0,
    "browserReady": true,
    "uptimeSeconds": 1420
  }
}
```

### B. Ping / Heartbeat
Klien dapat memantau kesehatan server dengan mengirim:
```json
{
  "type": "PING"
}
```
**Balasan Server (`PONG`):**
```json
{
  "type": "PONG",
  "stats": {
    "memory": {
      "totalMb": 4096,
      "usedMb": 1310,
      "freeMb": 2786,
      "usagePercent": 32
    },
    "activeJobs": 1,
    "browserReady": true,
    "uptimeSeconds": 1435
  }
}
```

### C. Mengirimkan Job Solver
**Request dari Klien:**
```json
{
  "id": "job_custom_9921",
  "mode": "auto",
  "url": "https://turnstile.zeroclover.io/",
  "proxy": {
    "host": "1.2.3.4",
    "port": 8080
  }
}
```

**Status Update dari Server (`JOB_STATUS`):**
```json
{
  "type": "JOB_STATUS",
  "id": "job_custom_9921",
  "status": "processing",
  "message": "Solving challenge..."
}
```

**Hasil Akhir dari Server (`JOB_RESULT`):**
```json
{
  "type": "JOB_RESULT",
  "id": "job_custom_9921",
  "status": "success",
  "code": 200,
  "data": {
    "mode": "auto",
    "url": "https://turnstile.zeroclover.io/",
    "siteKey": "0x4AAAAAAAEwzhD6pyKkgXC0",
    "token": "0.41bN9...x9ZvL2mP_KL0Q"
  }
}
```

---

## 7. Protokol WebSocket Worker Terdistribusi

Jika server dijalankan dengan variabel `MAIN_WS_URL`:

```bash
MAIN_WS_URL=ws://central-cluster.internal:9000/workers \
WORKER_ID=worker_node_sg_01 \
WORKER_SECRET=super_cluster_secret_2026 \
node src/index.js
```

1. **Registrasi**: Worker terhubung ke Master dengan URL berparameter `?secret=...&workerId=...`.
2. **Heartbeat Otomatis**: Setiap 15 detik, worker mengirim:
   ```json
   {
     "type": "HEARTBEAT",
     "workerId": "worker_node_sg_01",
     "stats": { ... }
   }
   ```
3. **Penerimaan Tugas (`JOB`)**: Master mengirim:
   ```json
   {
     "type": "JOB",
     "id": "cluster_task_8819",
     "data": {
       "url": "https://target.com",
       "mode": "waf-session"
     }
   }
   ```
4. **Pengiriman Hasil**: Worker menyelesaikan tugas dan mengembalikan payload `JOB_RESULT` ke Master.
