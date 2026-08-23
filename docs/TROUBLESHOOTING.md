# 🛠️ Panduan Pemecahan Masalah & Diagnostik (Troubleshooting Guide)

Dokumen ini menyediakan panduan diagnostik sistematis untuk mengidentifikasi, menganalisis, dan memperbaiki kendala yang mungkin dihadapi saat mengoperasikan **CEEF WAF Solver**.

---

## 📑 Daftar Isi
1. [Diagram Alur Diagnostik](#1-diagram-alur-diagnostik)
2. [Kamus Kesalahan (Error Matrix & Solusi)](#2-kamus-kesalahan-error-matrix--solusi)
3. [Masalah Spesifik Lingkungan (Docker / Linux / VPS)](#3-masalah-spesifik-lingkungan-docker--linux--vps)
4. [Dilema IP Mismatch pada `cf_clearance`](#4-dilema-ip-mismatch-pada-cf_clearance)
5. [Skrip Pengujian Mandiri (Self-Test Script)](#5-skrip-pengujian-mandiri-self-test-script)

---

## 1. Diagram Alur Diagnostik

```mermaid
flowchart TD
    Start([Request Solver Mengalami Kendala]) --> CkStatus{Apa Kode Respon / Pesan Error?}

    CkStatus -->|500 "The scanner is not ready"| BReady["Penyebab: Browser Utama Masih Inisialisasi\nSolusi: Cek endpoint GET / sampai browserReady: true"]
    
    CkStatus -->|500 "Timeout Error"| BTime{"Apakah Menggunakan Proxy?"}
    BTime -->|Ya| BProxy["Cek Proxy: Pastikan Host/Port/Auth aktif & stabil"]
    BTime -->|Tidak| BSite["Periksa Target: URL mungkin sedang down atau butuh waktu lebih lama\nSolusi: Naikkan env timeOut"]

    CkStatus -->|429 "Too Many Requests"| BLimit["Penyebab: Antrean Penuh (activeJobs >= browserLimit)\nSolusi: Naikkan env browserLimit atau tambah Worker Node"]

    CkStatus -->|400 "Bad Request"| BSchema["Penyebab: Skema JSON Tidak Valid\nSolusi: Cek field 'schema' pada JSON respon (Ajv validation)"]

    CkStatus -->|401 "Unauthorized"| BAuth["Penyebab: authToken Salah / Hilang\nSolusi: Masukkan field 'authToken' yang sesuai di JSON body"]

    CkStatus -->|Browser Crash / Disconnect Berulang| BOOM["Penyebab: OOM (Out Of Memory) / Missing /dev/shm\nSolusi: Tambah RAM/Swap atau tambahkan --shm-size=2gb di Docker"]
```

---

## 2. Kamus Kesalahan (Error Matrix & Solusi)

### A. `500 - The scanner is not ready yet. Please try again a little later.`
* **Penyebab**: Server baru saja menyala dan Chromium sedang diunduh atau diinisialisasi oleh `puppeteer-real-browser`.
* **Solusi**:
  1. Lakukan polling pada endpoint status `GET /`.
  2. Pastikan properti `"browserReady": true` sebelum mengirim request solving.

---

### B. `500 - Timeout Error`
* **Penyebab**: Browser tidak berhasil menyelesaikan challenge Cloudflare atau memuat halaman target dalam durasi batas waktu (`timeOut`).
* **Solusi**:
  1. Naikkan variabel environment `timeOut=120000` (120 detik).
  2. Jika menggunakan upstream proxy, uji apakah proxy tersebut tidak lambat (*high latency*) atau mati (*dead proxy*).
  3. Cek apakah situs target memblokir ASN dari IP server Anda. Coba gunakan proxy residensial.

---

### C. `429 - Too Many Requests`
* **Penyebab**: Beban request yang masuk melebihi batas `browserLimit` (default: 20).
* **Solusi**:
  1. Jika server memiliki sisa RAM yang cukup, naikkan `browserLimit=40` pada konfigurasi environment.
  2. Terapkan antrean di sisi aplikasi klien (*client-side concurrency limiter*).
  3. Gunakan arsitektur cluster terdistribusi dengan menambahkan worker node via `MAIN_WS_URL`.

---

### D. `400 - Bad Request (with schema error)`
* **Penyebab**: Payload request melanggar skema JSON yang didefinisikan di `src/module/reqValidate.js`.
* **Contoh Pesan**: `{"code": 400, "message": "Bad Request", "schema": [{"keyword": "enum", "message": "must be equal to one of the allowed values"}]}`.
* **Solusi**:
  - Pastikan nilai `mode` adalah salah satu dari: `"source"`, `"turnstile-min"`, `"turnstile-max"`, `"waf-session"`, `"auto"`, `"pinjam-ip"`.
  - Pastikan `url` berupa format URI valid (`https://...`).
  - Hapus properti yang tidak dikenali karena skema menyetel `additionalProperties: false`.

---

### E. `500 - Failed to auto-extract siteKey from target URL`
* **Penyebab**: Pada mode `auto`, CEEF tidak menemukan pola `siteKey` Turnstile di network traffic maupun DOM element.
* **Solusi**:
  1. Buka situs target secara manual menggunakan browser desktop, buka DevTools (F12) > Elements, lalu cari `data-sitekey`.
  2. Jika siteKey ditemukan, gunakan mode `turnstile-min` dengan menyertakan parameter `"siteKey": "0x4..."`.
  3. Atau gunakan mode `turnstile-max` yang merender seluruh halaman secara dinamis.

---

## 3. Masalah Spesifik Lingkungan (Docker / Linux / VPS)

### A. Chromium Crash di Docker: `Session closed. Most likely the page has been closed.`
* **Penyebab**: Ukuran shared memory `/dev/shm` default Docker terlalu kecil (hanya 64MB).
* **Solusi**: Tambahkan `--shm-size=2gb` pada `docker run` atau `shm_size: '2gb'` pada `docker-compose.yml`.

### B. Linux VPS Error: `Error: spawn Xvfb ENOENT` atau Layar Tidak Terdeteksi
* **Penyebab**: Paket `xvfb` belum terpasang di sistem operasi.
* **Solusi**: Jalankan `sudo apt update && sudo apt install -y xvfb` dan jalankan server melalui script `start.sh`.

---

## 4. Dilema IP Mismatch pada `cf_clearance`

### Gejala:
Anda menggunakan mode `waf-session` untuk mendapatkan cookie `cf_clearance` dari server CEEF, tetapi ketika cookie tersebut digunakan pada laptop lokal Anda, Cloudflare tetap memblokir request dengan status `403 Forbidden`.

### Penjelasan & Solusi:
Cloudflare mengikat (*bind*) hash kriptografis `cf_clearance` ke alamat IP publik server penyelesai.
* **Solusi 1**: Gunakan mode `pinjam-ip` agar request akhir dieksekusi langsung dari IP server CEEF.
* **Solusi 2**: Gunakan proxy yang sama saat memanggil CEEF dan saat mengirim request akhir dari klien.

---

## 5. Skrip Pengujian Mandiri (Self-Test Script)

Gunakan skrip Node.js berikut untuk menguji kesehatan seluruh fitur solver secara lokal:

```javascript
// test-health.js
async function runHealthTest() {
  const baseUrl = "http://localhost:7860";

  console.log("1. Menguji Status Server...");
  const health = await fetch(`${baseUrl}/`).then((r) => r.json());
  console.log("Health Respon:", health);

  if (!health.browserReady) {
    console.warn("⚠️ Browser belum siap, tunggu beberapa detik lagi...");
    return;
  }

  console.log("\n2. Menguji Turnstile Auto-Solver...");
  const turnstile = await fetch(`${baseUrl}/cf-clearance-scraper`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "auto",
      url: "https://turnstile.zeroclover.io/",
    }),
  }).then((r) => r.json());

  console.log("Hasil Auto-Solver:", turnstile);

  if (turnstile.code === 200 && turnstile.token) {
    console.log("\n🎉 SELURUH SISTEM CEEF BERFUNGSI SEMPURNA!");
  } else {
    console.error("\n❌ Terjadi kegagalan pada solver test.");
  }
}

runHealthTest();
```
