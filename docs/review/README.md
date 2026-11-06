# Review pack untuk Pak Jovian

Satu file ringkas untuk review 3 minggu pilot (mulai 11 Nov 2026): lead per sumber dan sales, waktu catat, konversi tiap tahap, win rate, alasan lost, diskon, iklan ke CRM, target, dan usulan perubahan. Setiap angka punya query SQL-nya di bagian Lampiran (dilipat), jadi siapa pun bisa mengeceknya.

Skripnya hanya membaca. Semua query adalah `SELECT` dan berjalan dalam satu transaksi read-only, jadi tidak ada data yang bisa berubah.

Contoh hasilnya (data demo, bukan angka asli): [contoh-data-demo.md](contoh-data-demo.md).

## Menjalankan di produksi

Kamu butuh: komputer dengan repo ini, Node 24 dan `npm install` yang sudah jalan, serta akses ke project Railway.

### 1. Buat akun database yang hanya bisa membaca (sekali saja)

Ini membuat skrip tidak mungkin mengubah apa pun, walaupun ada yang salah.

1. Buka Railway, project Fortu CRM, service `postgres`, tab **Data**, lalu **Query**.
2. Jalankan ini satu per satu. Ganti `GANTI_PASSWORD` dengan password panjang yang baru (bukan password yang sudah dipakai di tempat lain) dan `railway` dengan nama database kalau berbeda (lihat `PGDATABASE` di tab **Variables**).

```sql
CREATE ROLE review_reader LOGIN PASSWORD 'GANTI_PASSWORD';
GRANT CONNECT ON DATABASE railway TO review_reader;
GRANT USAGE ON SCHEMA public TO review_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO review_reader;
ALTER ROLE review_reader SET default_transaction_read_only = on;
```

3. Simpan password itu di password manager. Jangan tulis di chat atau di repo.

### 2. Ambil alamat database

1. Di service `postgres`, tab **Variables** (atau **Connect**), cari alamat publik: `DATABASE_PUBLIC_URL`.
2. Alamatnya berbentuk `postgresql://postgres:PASSWORD@HOST:PORT/railway`. Ganti `postgres:PASSWORD` dengan `review_reader:GANTI_PASSWORD` (password dari langkah 1). Sisanya (HOST, PORT, nama database) tetap.

### 3. Jalankan skrip

Di Terminal, dari folder repo:

```bash
export REVIEW_DATABASE_URL='postgresql://review_reader:GANTI_PASSWORD@HOST:PORT/railway'
npm run review:pack
```

Tanpa pilihan lain, periodenya 11 Nov 2026 sampai 1 Des 2026 (21 hari). Untuk periode lain:

```bash
npm run review:pack -- --from 2026-11-11 --to 2026-11-25
```

Skrip menulis `docs/review/2026-12-review.md` dan menampilkan alamat database (tanpa password) yang dibaca, supaya kamu yakin yang dibaca adalah produksi. Jangan pakai `.env.local` untuk alamat produksi; pakai `export` seperti di atas, lalu tutup Terminal setelah selesai.

Pilihan lain: `--out lokasi/file.md` untuk nama file lain, dan `--label "teks"` untuk menaruh catatan di bagian atas.

### 4. Cek hasilnya

1. Buka `docs/review/2026-12-review.md`. Kalau ada kata "Data belum cukup", itu memang disengaja: datanya belum cukup untuk memberi usulan.
2. Untuk mengecek satu angka, buka **Lampiran** di bawah file, buka query-nya, dan jalankan di Railway (service `postgres`, **Data**, **Query**). Ganti `$1` dengan tanggal awal dan `$2` dengan tanggal akhir, contoh `'2026-11-11'::date` dan `'2026-12-01'::date`. Hasilnya harus sama dengan angka di file.
3. Hapus akun baca kalau sudah tidak dipakai: `DROP OWNED BY review_reader; DROP ROLE review_reader;`

## Cara membaca angkanya

- Rupiah sebelum PPN. Waktu jam Jakarta (WIB). Periode memakai tanggal Jakarta, awal dan akhir ikut dihitung.
- Lead dihitung dari tanggal chat masuk. Win rate, alasan lost dan nilai Done deal dihitung dari tanggal selesai (`closed_on`, tanggal pembayaran untuk Done deal).
- Konversi dan lama di tiap tahap dihitung dari semua deal sejak CRM dipakai, bukan hanya periode ini (view `v_stage_conversion`).
- Target dihitung per bulan penuh. Bulan yang belum selesai ditandai "(berjalan)" dan tidak dipakai untuk usulan.
- "Waktu catat" memakai jam chat masuk yang diisi sales, jadi ini seberapa cepat chat dicatat.
- Tingkat tercatat iklan = lead di CRM yang punya iklan (kode iklan) dibagi chat iklan menurut Meta (`ad_insights_daily`), maksimal 100%.

## Usulan perubahan

Bagian 5 file berisi usulan untuk target, peluang tahap, batas hari belum bergerak, dan aturan. Semuanya **belum diterapkan**; tidak ada yang berubah di CRM. Setiap usulan menyebut angka yang mendasarinya. Kalau datanya kurang dari batas minimal (tertulis di file, misalnya 10 deal), tertulis "Data belum cukup" dan tidak ada usulan.

Batas-batasnya ada di `RULES` dalam `scripts/review-pack-report.mjs`. Ubah di sana kalau tim sepakat memakai batas lain.

## Untuk yang mengembangkan

- `scripts/review-pack-queries.mjs`: semua query (hanya `SELECT`), dan `runQueries()` yang membukanya dalam transaksi read-only.
- `scripts/review-pack-report.mjs`: mengubah hasil query jadi teks Markdown, dan menghitung usulan.
- `scripts/review-pack.mjs`: perintah yang kamu jalankan.
- `tests/reviewPack.test.ts`: menjalankan query di database uji dan mencocokkan jumlahnya dengan view.
