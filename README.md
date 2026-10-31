# Flight SMART

Arsip log terbang drone DJI yang memproses dirinya sendiri, seperti Airdata: unggah log
`DJIFlightRecord_*.txt`, lalu GitHub mengubahnya menjadi GPX, KML, CSV, dan peta. Repo ini juga
punya alat untuk mengisi data SMART pada setiap foto drone dan mengekspornya sebagai JSON
SMART Mobile yang langsung bisa diimpor ke SMART Desktop (model **SMART TN TAMBORA 2026**).

- **Aplikasi:** <https://kopluck8.github.io/Flight_SMART/>, atau unduh [`index.html`](index.html) lalu buka di komputer.
- **Daftar penerbangan:** [FLIGHTS.md](FLIGHTS.md)

## Cara kerja

1. Log masuk ke folder [`logs/`](logs/), dari tab **Sinkron log** di aplikasi atau dari halaman unggah GitHub.
2. GitHub Actions memproses log baru dalam ±1 menit dan menyimpan hasilnya di `flights/<tanggal>_<jam>/`:

   | File | Isi |
   |---|---|
   | `track.gpx` | Jalur terbang untuk Google Earth, QGIS, Garmin, dan aplikasi lain |
   | `track.kml` | Jalur terbang untuk Google Earth |
   | `track.geojson` | Jalur, titik home, dan titik foto; tampil sebagai peta saat dibuka di GitHub |
   | `frames.csv` | Data per detik dengan kolom mirip Airdata (posisi, ketinggian, kecepatan, baterai, gimbal, foto) |
   | `summary.json` | Ringkasan penerbangan |
   | `track.json` | Data ringkas untuk aplikasi |

3. Semua penerbangan tercantum di [FLIGHTS.md](FLIGHTS.md) dan di tab **Penerbangan**.

Jam memakai WITA (UTC+08:00). Ubah di [`flight-smart.config.json`](flight-smart.config.json) bila perlu.

## Persiapan (sekali saja)

1. **Kunci API DJI.** Log versi 13 ke atas (DJI Fly dan DJI GO 4 versi baru) terenkripsi, jadi perlu kunci dari DJI:
   1. Masuk ke <https://developer.dji.com/user/apps>, tekan **CREATE APP**, pilih App Type **Open API**, isi nama dan deskripsi.
   2. Aktifkan aplikasi lewat tautan di email, lalu salin **App Key** (SDK key).
   3. Simpan di repo sebagai secret bernama `DJI_API_KEY`:
      [Settings → Secrets and variables → Actions → New repository secret](https://github.com/kopluck8/Flight_SMART/settings/secrets/actions/new).
2. **Token GitHub** untuk mengunggah dari aplikasi: buat
   [fine-grained token](https://github.com/settings/personal-access-tokens/new) dengan *Repository access* hanya
   `Flight_SMART`, izin **Contents: Read and write** dan **Actions: Read-only**. Tempel di tab **Pengaturan**.
   Token hanya disimpan di peramban perangkat itu.
3. **Daftar petugas SMART.** Di tab **Foto → SMART**, tekan **Muat daftar petugas** dan pilih paket SMART Mobile
   (`.zip`) atau `patrol_metadata.json`. Nama petugas sengaja tidak disimpan di repo.

## Sinkron log

- Lokasi log di ponsel Android: DJI GO 4 di `DJI/dji.go.v4/FlightRecord/`, DJI Fly di
  `Android/data/dji.go.v5/files/FlightRecord/` (sambungkan ke komputer dengan kabel USB bila folder ini tidak bisa
  dibuka dari ponsel). Di iPhone, ambil lewat Finder/iTunes → File Sharing → aplikasi DJI → FlightRecords.
- Tab **Sinkron log** → pilih file → **Unggah**. Log yang sudah ada di repo dilewati otomatis.
- Tanpa token: buka <https://github.com/kopluck8/Flight_SMART/upload/main/logs>, seret file log, tekan **Commit changes**.
- Proses ulang semua log (misalnya setelah menambahkan `DJI_API_KEY`): tab **Actions** → **Proses log penerbangan** →
  **Run workflow** → centang *Proses ulang semua log*. Log yang sebelumnya gagal otomatis dicoba lagi setiap ada log baru.

## Foto drone → SMART

1. **Data patroli:** jenis transportasi (otomatis *Drone*), mandat, tim, pos, petugas, ketua, dan pilot.
2. **Penerbangan:** penerbangan yang jamnya cocok dengan jam foto dipilih otomatis. Setiap penerbangan menjadi satu
   segmen patroli (jeda/lanjut di antaranya) dan jalurnya menjadi waypoint SMART.
3. **Foto:** pilih foto JPG dari kartu SD drone. Lokasi diambil dari GPS foto; foto tanpa GPS diberi lokasi dari
   jalur penerbangan pada jam foto. Beri kategori dan atribut untuk setiap foto. Isian satu foto bisa disalin ke
   banyak foto sekaligus.
4. **Ekspor:** unduh file `SMDATA_….json`, lalu di SMART Desktop buka **Field Data → SMART Mobile → Import…**,
   ubah *Import From* menjadi **Files**, tekan **Add**, pilih file tersebut, lalu **Import**.

Foto tidak diunggah ke GitHub; semuanya diproses di peramban. Isian tersimpan di peramban, jadi aman bila halaman
tertutup. Foto diperkecil ke sisi terpanjang 1600 piksel agar file JSON tidak terlalu besar (bisa diubah di Pengaturan).

## Memperbarui model SMART

Bila Configurable Model berubah, ganti [`data/smart/cm_model.xml`](data/smart/) (dari paket SMART Mobile atau ekspor
Configurable Model) dan `data/smart/project.json`. GitHub Actions merakit ulang aplikasi secara otomatis. Model baru
juga bisa dimuat langsung di tab **Pengaturan**, tetapi hanya berlaku di perangkat itu.

## Privasi

Selama repo ini public, siapa pun bisa melihat log, jalur terbang, dan model SMART di dalamnya. Jadikan repo private
bila jalur patroli tidak boleh terbuka. Aplikasi tetap berjalan dengan token, tetapi GitHub Pages gratis tidak bisa
untuk repo private, jadi buka `index.html` langsung dari komputer.

## Pengembangan

```bash
npm ci
npm test          # uji pemroses log dan pembuat JSON SMART
npm run build     # rakit app/ menjadi index.html
npm run process   # proses logs/ secara lokal (DJI_API_KEY=... untuk log v13+)
```

| Folder | Isi |
|---|---|
| `app/` | Kode aplikasi web (dirakit menjadi `index.html`) |
| `scripts/` | Pemroses log DJI dan perakit aplikasi |
| `data/smart/` | Configurable Model dan metadata patroli SMART (tanpa nama petugas) |
| `logs/` | Log asli DJI |
| `flights/` | Hasil olahan per penerbangan dan `index.json` |

Log dibaca dengan [dji-log-parser-js](https://www.npmjs.com/package/dji-log-parser-js) (MIT).
