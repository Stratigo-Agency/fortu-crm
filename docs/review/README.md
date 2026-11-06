# Review pack untuk Pak Jovian

Satu file ringkas untuk review 3 minggu pilot (mulai 11 Nov 2026): lead per sumber dan sales, waktu catat, konversi tiap tahap, win rate, alasan lost, diskon, iklan ke CRM, target, dan usulan perubahan. Setiap angka punya query SQL-nya di bagian Lampiran (dilipat), jadi siapa pun bisa mengeceknya.

Skripnya hanya membaca. Semua query adalah `SELECT` dan berjalan dalam satu transaksi read-only. Di produksi, akun yang dipakai juga hanya punya hak `SELECT`, jadi tidak ada data yang bisa berubah. Data contoh (`is_sample`) tidak ikut dihitung.

Contoh hasilnya (data demo, bukan angka asli): [contoh-data-demo.md](contoh-data-demo.md).

## Menjalankan di produksi

Kamu butuh: komputer dengan repo ini, Node 24 dan `npm install` yang sudah jalan, serta akses ke project Railway.

### 1. Buat akun database yang hanya bisa membaca (sekali saja)

Akun ini hanya diberi hak membaca (`SELECT`). Itulah yang membuat skrip tidak bisa mengubah data. Skrip juga membuka transaksi read-only sebagai lapisan kedua.

1. Buka Railway, project Fortu CRM, service `postgres`, tab **Data**, lalu **Query**.
2. Jalankan ini satu per satu. Ganti `GANTI_PASSWORD` dengan password baru yang panjang (30 karakter atau lebih) dan hanya berisi huruf dan angka, supaya aman ditaruh di alamat database. Jangan pakai password yang sudah dipakai di tempat lain. Ganti juga `railway` dengan nama database kalau berbeda (lihat `PGDATABASE` di tab **Variables**).

```sql
CREATE ROLE review_reader LOGIN PASSWORD 'GANTI_PASSWORD' CONNECTION LIMIT 2;
GRANT CONNECT ON DATABASE railway TO review_reader;
GRANT USAGE ON SCHEMA public TO review_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO review_reader;
ALTER ROLE review_reader SET statement_timeout = '60s';
```

`CONNECTION LIMIT 2` membatasi akun ini ke dua sambungan, dan `statement_timeout` menghentikan query yang berjalan lebih dari 60 detik, jadi review tidak bisa membebani database yang dipakai tim.

3. Simpan password itu di password manager. Jangan tulis di chat atau di repo.

### 2. Ambil alamat database

1. Di service `postgres`, tab **Variables** (atau **Connect**), cari alamat publik: `DATABASE_PUBLIC_URL`.
2. Alamatnya berbentuk `postgresql://postgres:PASSWORD@HOST:PORT/railway`. Ganti `postgres:PASSWORD` dengan `review_reader:GANTI_PASSWORD` (password dari langkah 1). Sisanya (HOST, PORT, nama database) tetap. Tambahkan `?sslmode=require` di ujungnya, karena alamat publik Railway harus lewat sambungan terenkripsi.

### 3. Jalankan skrip

Di Terminal, dari folder repo:

```bash
read -rs REVIEW_DATABASE_URL    # tempel alamat database lengkap, lalu tekan Enter (layar tidak menampilkan apa-apa)
export REVIEW_DATABASE_URL
npm run review:pack
```

Alamat yang kamu tempel berbentuk `postgresql://review_reader:GANTI_PASSWORD@HOST:PORT/railway?sslmode=require`. Dengan `read -rs`, password tidak tertulis di layar dan tidak masuk riwayat perintah Terminal.

Tanpa pilihan lain, periodenya 11 Nov 2026 sampai 1 Des 2026 (21 hari). Untuk periode lain:

```bash
npm run review:pack -- --from 2026-11-11 --to 2026-11-25
```

Skrip menulis `docs/review/2026-12-review.md` (file ini berisi angka asli dan tidak ikut ter-commit, sudah ada di `.gitignore`) dan menampilkan alamat database tanpa user dan password, supaya kamu yakin yang dibaca adalah produksi. Kalau ada error, alamat dengan password di dalamnya juga disembunyikan dari pesan. Jangan pakai `.env.local` untuk alamat produksi; pakai `read -rs` seperti di atas, lalu tutup Terminal setelah selesai.

Pilihan lain: `--out lokasi/file.md` untuk nama file lain, dan `--label "teks"` untuk menaruh catatan di bagian atas. `--include-sample` ikut menghitung data contoh; ini hanya untuk membuat file contoh dari data demo dan jangan dipakai untuk angka asli.

### 4. Cek hasilnya

1. Buka `docs/review/2026-12-review.md`. Kalau ada kata "Data belum cukup", itu memang disengaja: datanya belum cukup untuk memberi usulan.
2. Untuk mengecek satu angka, buka **Lampiran** di bawah file, buka query-nya, dan jalankan di Railway (service `postgres`, **Data**, **Query**). Ganti `$1` dengan tanggal awal dan `$2` dengan tanggal akhir, contoh `'2026-11-11'::date` dan `'2026-12-01'::date`. Hasilnya harus sama dengan angka di file.
3. Hapus akun baca kalau sudah tidak dipakai: `DROP OWNED BY review_reader; DROP ROLE review_reader;`

Query di Lampiran memakai `$1` dan `$2` untuk tanggal. Query yang memakai data contoh juga punya `$3` (isi `false`), dan query tanpa periode memakai `$1` sebagai `false`. Baris `Parameter:` di tiap query menyebut isinya.

## Cara membaca angkanya

- Rupiah sebelum PPN. Waktu jam Jakarta (WIB). Periode memakai tanggal Jakarta, awal dan akhir ikut dihitung.
- Lead dihitung dari tanggal chat masuk. Win rate, alasan lost dan nilai Done deal dihitung dari tanggal selesai (`closed_on`, tanggal pembayaran untuk Done deal).
- Angka dibulatkan di file: Rupiah ke juta atau miliar, persen dan hari satu desimal.
- Data contoh (`is_sample`) tidak dihitung di angka mana pun. Konversi tahap dan target dihitung ulang dari tabel `deals` (view `v_stage_conversion` dan `v_target_attainment` tidak menyaring data contoh).
- Konversi dan lama di tiap tahap dihitung dari semua deal sejak CRM dipakai, bukan hanya periode ini. Tiap deal dihitung sekali per tahap; deal yang mundur ke tahap sebelumnya punya kolom sendiri.
- Target: hanya bulan kalender yang seluruhnya ada di dalam periode yang dipakai untuk usulan. Bulan yang hanya sebagian (misalnya November, karena pilot mulai tanggal 11) ditandai "(sebagian)", hanya menghitung Done deal di dalam periode, dan tidak dipakai untuk usulan.
- "Waktu catat" hanya untuk lead yang dicatat manual oleh sales (Tambah cepat). Lead dari form website, tombol WA, dan sistem dicatat otomatis, jadi tidak dihitung. Jam chat masuk diisi sales.
- Tingkat tercatat iklan = lead sumber iklan Meta / WA di CRM yang punya iklan (kode iklan) dibagi chat iklan menurut Meta (`ad_insights_daily`). Angkanya tidak dibatasi 100%; kalau lebih dari 100%, file menulis "lebih dari 100%" dan tidak memberi usulan.
- Diskon punya dua hitungan dengan tanggal berbeda: disetujui (menurut tanggal persetujuan) dan deal di atas batas (menurut tanggal deal dibuat).
- Win rate di bawah 10 deal selesai ditandai "(sedikit data)".

## Usulan perubahan

Bagian 5 file berisi usulan untuk target, peluang tahap, batas hari belum bergerak, dan aturan. Semuanya **belum diterapkan**; tidak ada yang berubah di CRM. Setiap usulan menyebut angka yang mendasarinya. Kalau datanya kurang dari batas minimal (tertulis di file, misalnya 10 deal, dan 20 deal selesai untuk peluang tahap), tertulis "Data belum cukup" dan tidak ada usulan.

Dua catatan cara membacanya. Usulan peluang tahap hanya melihat deal yang sudah selesai; deal yang masih terbuka tidak dihitung (jumlahnya ditulis), jadi hasilnya bisa condong ke deal yang cepat selesai. Usulan batas hari memakai persentil ke-75 lama deal di tahap itu (3 dari 4 deal yang sudah pindah), bukan median.

Batas-batasnya ada di `RULES` dalam `scripts/review-pack-report.mjs`. Ubah di sana kalau tim sepakat memakai batas lain.

## Untuk yang mengembangkan

- `scripts/review-pack-queries.mjs`: semua query (hanya `SELECT`), dan `runQueries()` yang membukanya dalam transaksi read-only.
- `scripts/review-pack-report.mjs`: mengubah hasil query jadi teks Markdown, dan menghitung usulan.
- `scripts/review-pack.mjs`: perintah yang kamu jalankan.
- `tests/reviewPack.test.ts`: menjalankan query di database uji, mencocokkan jumlahnya dengan data, dan memeriksa bahwa data contoh, bulan sebagian, batas hari Jakarta, dan password tidak bocor.
