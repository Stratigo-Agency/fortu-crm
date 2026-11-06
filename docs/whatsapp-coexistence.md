# WhatsApp Coexistence untuk nomor sales

T19 · Linear MAR-158 · ditulis 6 Nov 2026. Dokumen ini untuk Pak Jovian, sales lead, admin, dan sales yang nomornya
akan disambungkan. Bagian teknis untuk admin ada di bawah.

## Apa fungsinya

Sales tetap memakai aplikasi **WhatsApp Business** di HP seperti biasa. Setelah nomornya disambungkan ke CRM
(namanya *Coexistence*: aplikasi di HP dan CRM jalan bersamaan), Meta mengirim kabar ke CRM setiap ada chat:

- **Chat baru dari calon pembeli** langsung jadi prospek di CRM, atas nama sales pemilik nomor. Tidak perlu
  dicatat manual lagi. Chat dari iklan Click-to-WhatsApp otomatis tercatat iklannya.
- **Balasan sales dari HP** dicatat waktunya. Dari situ CRM menghitung berapa cepat tiap sales membalas chat
  pertama (Laporan › Kecepatan balas chat) dan memberi tanda "Chat belum dibalas > 2 jam" di Perlu perhatian.
  Tanda itu hanya terlihat oleh sales pemilik chat. Yang dihitung adalah pesan balasan sungguhan, bukan tombol
  "Sudah dihubungi" (lihat *Waktu balas* di bawah).

Yang dicatat CRM untuk setiap pesan: arah (masuk / keluar), jam, jenis (teks, gambar, …), nomor id pesan, dan
nomor sales. **Isi pesan tidak disimpan**, kecuali admin menyalakan "Simpan isi pesan" untuk nomor itu. Kalau
dinyalakan, isi pesan hanya bisa dibaca oleh sales pemilik nomor, CEO, dan admin: di Prospek dan di deal, sales lain
melihat kolom pesan kosong, dan pencarian tidak menemukan isi pesan. Isi pesan tidak pernah ditulis ke log server
atau ke catatan mentah webhook. Mematikan "Simpan isi pesan" langsung menghapus semua isi pesan nomor itu.

Riwayat chat lama (sampai 180 hari) ikut dikirim Meta saat penyambungan. CRM menyimpan catatan waktunya saja dan
**tidak** membuat prospek dari riwayat lama. Untuk orang yang belum ada di CRM, nomor HP-nya pun tidak disimpan.
Daftar kontak HP juga dikirim Meta, tapi CRM **tidak menyimpannya sama sekali**: CRM tidak membutuhkannya, karena
kontak dicocokkan dari chat yang masuk.

## Yang dilihat Pak Rudi (sales) dan yang berubah di aplikasinya

Menurut dokumentasi Meta, setelah nomor tersambung:

- Chat 1:1 tetap jalan biasa di HP. Mengirim pesan dari aplikasi tetap **gratis**.
- **Broadcast list** tidak bisa dipakai lagi; daftar yang sudah ada jadi hanya-baca.
- Di chat 1:1: **pesan sementara (disappearing)**, **sekali lihat (view once)** dan **lokasi terkini (live
  location)** dimatikan.
- **Grup** tidak ikut tersambung ke CRM (grup tetap jalan di HP, tapi CRM tidak melihatnya).
- Semua **perangkat tertaut** (WhatsApp Web, laptop, tablet) dilepas saat penyambungan. Bisa ditautkan lagi
  (maksimal 4). **WhatsApp untuk Windows** dan WearOS **tidak didukung**: pakai WhatsApp Web di browser.
- **Buka aplikasi WhatsApp Business di HP minimal sekali setiap ~14 hari.** Kalau HP utama tidak aktif sekitar
  14 hari, Meta memutus sambungan (alasan `PRIMARY_INACTIVITY`) dan nomor harus disambungkan ulang.
- Kecepatan kirim nomor yang tersambung dibatasi 20 pesan per detik. Untuk chat sales biasa ini tidak terasa.
- Aplikasi WhatsApp Business minimal versi **2.24.17**. Perbarui dulu dari Play Store / App Store.
- Biarkan aplikasi terbuka selama riwayat chat dikirim setelah penyambungan.

## Formulir persetujuan sales

Penyambungan hanya boleh dilakukan setelah sales setuju secara tertulis. Di Pengaturan › WhatsApp, admin wajib
mencentang persetujuan dan menulis nama sales; CRM menyimpan siapa, kapan, dan siapa yang mencatat. Nomor tanpa
persetujuan tidak diproses sama sekali (pesannya diabaikan dan tidak disimpan).

Teks yang ditandatangani sales (cetak, tanda tangan, simpan di HR):

> **Persetujuan pencatatan chat WhatsApp kerja**
>
> Saya, ______________________ (nama), pemakai nomor WhatsApp Business ______________________ untuk pekerjaan
> di PT Fortu Digital Indonesia, setuju nomor ini disambungkan ke CRM Fortu lewat WhatsApp Business Platform
> (Coexistence).
>
> Saya mengerti bahwa:
> 1. CRM mencatat waktu, arah, dan jenis setiap pesan di nomor ini, untuk mengukur kecepatan balas dan asal
>    prospek. Chat baru dari calon pembeli otomatis menjadi prospek atas nama saya.
> 2. Isi pesan hanya disimpan jika perusahaan menyalakannya untuk nomor ini, dan hanya bisa dibaca oleh saya,
>    CEO, dan admin CRM.
> 3. Riwayat chat sampai 180 hari ikut dikirim ke CRM saat penyambungan; CRM hanya mencatat waktunya. Daftar
>    kontak di aplikasi ikut dikirim Meta tetapi tidak disimpan CRM. Saya boleh menolak berbagi riwayat chat pada
>    langkah "Confirm history".
> 4. Beberapa fitur aplikasi berubah (broadcast list, pesan sementara, sekali lihat, lokasi terkini, perangkat
>    tertaut), seperti dijelaskan kepada saya.
> 5. Saya boleh mencabut persetujuan ini kapan saja dengan memberi tahu admin, atau dengan memutus sambungan di
>    aplikasi (Settings › Account › Business Platform › Disconnect Account). Setelah dicabut, pesan baru tidak
>    dicatat lagi dan isi pesan yang tersimpan dihapus.
>
> Tanggal: ____________  Tanda tangan: ____________

## Langkah di HP (saat admin menekan "Sambungkan nomor")

Admin dan sales duduk bersama. Admin membuka Pengaturan › WhatsApp di laptop, memilih sales, menulis namanya,
mencentang persetujuan, lalu menekan **Sambungkan nomor**. Jendela Meta terbuka:

1. Di jendela Meta (laptop): pilih menyambungkan akun **WhatsApp Business app** yang sudah ada, lalu ketik nomor
   sales.
2. Jendela Meta menampilkan **kode**. Biarkan terbuka.
3. Di HP sales masuk pesan dari akun resmi Facebook Business. Ketuk **Connect**.
4. Ketuk **Connect to the Business Platform**.
5. Ketuk **Confirm** untuk berbagi riwayat chat (atau pilih tidak berbagi).
6. Masukkan kode dari langkah 2 di HP, lalu selesaikan di jendela Meta sampai **Finish**.

Kode dari Meta hanya berlaku 30 detik; CRM langsung memakainya. Kalau muncul "Kode dari Meta sudah kedaluwarsa",
ulangi dari awal. Setelah berhasil, nomor muncul di daftar dengan mode "Tersambung ke CRM".

**Memutus sambungan** (sales sendiri bisa): di aplikasi WhatsApp Business › **Settings › Account › Business
Platform › Disconnect Account**. CRM menerima kabar `PARTNER_REMOVED`, berhenti memproses nomor itu, menghapus izin,
mematikan "Simpan isi pesan" dan menghapus isi pesan yang tersimpan.

**Cabut izin** di Pengaturan › WhatsApp (admin, CEO): CRM dulu meminta Meta berhenti mengirim webhook untuk akun
WhatsApp sales itu (`DELETE /<WABA_ID>/subscribed_apps`), lalu nomor kembali ke mode "Aplikasi saja", izin dan
token dihapus, "Simpan isi pesan" mati, dan isi pesan yang tersimpan dihapus. Kalau Meta tidak bisa dihubungi, nomor
tetap dilepas di CRM dan webhook yang masih datang untuk nomor itu dibuang tanpa disimpan.

**Menyambungkan ulang** butuh persetujuan baru (centang dan nama lagi). "Simpan isi pesan" mulai dari mati, dan isi
pesan dari sambungan lama dihapus.

## Yang harus disiapkan admin di Meta (sekali)

Tidak ada yang diubah di Meta oleh CRM ini; semua langkah di bawah dilakukan admin sendiri.

1. **Meta app dengan status Tech Provider** (atau Solution Partner) di Meta Business Suite milik Fortu. Coexistence
   hanya bisa dipakai lewat Embedded Signup oleh Tech Provider / Solution Partner. Biasanya perlu **verifikasi
   bisnis** (belum dikonfirmasi untuk kasus kita).
2. Produk **WhatsApp** dan **Facebook Login for Business** di app itu.
3. **Konfigurasi Embedded Signup** (Facebook Login for Business › Configurations) untuk WhatsApp; catat
   *Configuration ID* → `META_ES_CONFIG_ID`. Embedded Signup v2/v3 berhenti 15 Okt 2026: pakai versi terbaru (v4).
4. Di pengaturan login app: tambahkan domain CRM ke **Allowed domains** dan **Valid OAuth redirect URIs** (https).
5. **Webhook** (WhatsApp › Configuration):
   - Callback URL: `<AUTH_URL>/api/v1/webhooks/whatsapp` (contoh `https://crm.fortu.co.id/api/v1/webhooks/whatsapp`)
   - Verify token: teks acak panjang yang sama dengan `META_VERIFY_TOKEN`
   - Field yang dilanggan: `messages`, `account_update`, `history`, `smb_app_state_sync`, `smb_message_echoes`
6. Variabel di Railway (service `web`): `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_ES_CONFIG_ID`,
   opsional `META_GRAPH_VERSION` dan `WA_TOKEN_KEY` (docs/deploy.md · WhatsApp webhook on `web`). Lalu service
   `cron-retry-inbound` (docs/deploy.md).
7. **Alamat HTTPS publik wajib.** Meta tidak bisa mengirim webhook ke `localhost`. Pakai alamat Railway, atau untuk
   uji di laptop sebuah tunnel (misalnya Cloudflare Tunnel / ngrok) yang meneruskan ke `npm run dev`.

Yang dilakukan CRM sesudah sales menekan Finish (otomatis, di server): menukar kode menjadi token bisnis
(`GET /oauth/access_token`), menyimpan token terenkripsi (tidak pernah dikirim ke browser), melanggan webhook untuk
akun WhatsApp itu (`POST /<WABA_ID>/subscribed_apps`), lalu meminta sinkronisasi kontak dan riwayat
(`POST /<PHONE_NUMBER_ID>/smb_app_data` dengan `sync_type` `smb_app_state_sync`, lalu `history`). Sinkronisasi
hanya bisa sekali per penyambungan dan harus dalam 24 jam setelah penyambungan; kalau gagal, pesan di layar
memberi tahu, dan cara mengulangnya adalah memutus lalu menyambungkan ulang nomor.

## Keputusan go / no-go

**Rekomendasi: go untuk satu nomor uji (Pak Rudi) selama 2 minggu, belum untuk semua sales.**

Alasan go:
- Sales tidak pindah aplikasi dan pesan dari aplikasi tetap gratis.
- Prospek dari WhatsApp tercatat sendiri, termasuk iklannya; ini masalah terbesar di Prospek sekarang
  (chat dari iklan yang tidak tercatat).
- Kecepatan balas dan konversi per sales bisa diukur, yang diminta Pak Jovian.
- Privasi bisa dijaga: hanya catatan waktu, isi pesan mati secara default, ada persetujuan tertulis dan bisa dicabut.

Syarat sebelum semua sales:
- Status Tech Provider dan Embedded Signup berjalan untuk akun bisnis Fortu (belum dicoba).
- Satu nomor uji berjalan 2 minggu tanpa putus, dan echo balasan dari HP benar-benar datang (dokumentasi bilang ya,
  belum kita lihat sendiri dengan nomor Indonesia).
- Sales paham perubahan di aplikasi (broadcast list, perangkat tertaut, Windows).

Alasan menunda / no-go kalau terjadi:
- Indonesia ternyata tidak didukung untuk Coexistence, atau verifikasi bisnis tertahan.
- Sales sangat bergantung pada broadcast list atau WhatsApp untuk Windows.
- Echo balasan tidak datang (maka kecepatan balas tidak bisa diukur dan manfaat utamanya hilang).

## Pertanyaan terbuka (belum dikonfirmasi)

- **Negara**: dokumentasi yang kami baca tidak menyebut Indonesia di daftar didukung atau tidak didukung. Perlu
  dicek di halaman Meta terbaru atau dengan uji nyata.
- **Verifikasi bisnis dan nama tampilan**: apakah wajib sebelum Coexistence untuk nomor aplikasi, dan berapa lama.
- **Status Tech Provider**: apakah app Meta Fortu sudah / bisa menjadi Tech Provider, atau perlu lewat Solution
  Partner.
- **Versi Embedded Signup**: tombol memakai `featureType: whatsapp_business_app_onboarding` dan
  `sessionInfoVersion: 3` seperti di dokumentasi Coexistence; dokumentasi juga menyebut v4/v5 (di v5 Coexistence
  aktif tanpa `featureType`). Cek konfigurasi yang dibuat di Meta saat uji pertama.
- **Nomor dengan username**: lihat *Risiko: nomor tersembunyi* di bawah.
- **Nomor luar negeri**: CRM hanya menyimpan nomor +62; chat dari nomor luar negeri dicatat waktunya saja.

## Risiko: nomor tersembunyi (username / BSUID)

Meta sedang memperkenalkan **username** WhatsApp. Pengguna yang memakai username bisa menyembunyikan nomor HP-nya;
webhook lalu hanya membawa **BSUID** (`from_user_id` / `user_id`, id pengguna khusus untuk akun bisnis kita), tanpa
`from` / `wa_id`. Akibatnya untuk CRM:

- **Tidak ada prospek** dari chat itu, karena prospek dan kontak di CRM dikenali dari nomor +62. Pesannya tetap
  dicatat (waktu, arah, BSUID) dan catatan event di `inbound_events` berisi `no_phone`.
- Begitu orang yang sama pernah terlihat dengan nomornya (misalnya ia menulis lagi tanpa menyembunyikan nomor),
  CRM menyimpan pasangan BSUID ↔ kontak (`wa_contacts`). Sejak itu chat dengan BSUID saja ikut masuk ke kontak
  dan prospeknya, dan pesan-pesan lama dengan BSUID itu dihubungkan ke kontaknya (sehingga balasan sales yang
  terlanjur tercatat ikut terhitung).
- Yang **tidak** dilakukan: membuat prospek mundur dari pesan BSUID-saja yang lebih lama, termasuk iklan
  (referral) pesan itu. Prospek dibuat saat nomor pertama kali terlihat, dengan waktu dan iklan pesan itu. Ini
  sengaja sederhana; kalau ternyata sering terjadi, langkah berikutnya adalah menyimpan referral di `wa_messages`
  dan membuat prospek dari pesan BSUID pertama.
- Pengguna dengan username yang tidak pernah memperlihatkan nomornya tidak akan pernah jadi prospek otomatis.
  Sales tetap bisa mencatatnya lewat Tambah cepat kalau nomornya diberikan di chat.
- Seberapa sering ini terjadi di Indonesia belum diketahui. Pantau catatan `no_phone` selama uji 2 minggu.

## Waktu balas

Waktu balas pertama sebuah prospek = pesan **keluar** pertama di nomor itu ke kontak itu, sesudah pesan pembeli
yang membuat prospek (`v_wa_lead_first_reply`, dari `wa_messages`). Urutan webhook tidak berpengaruh: kalau echo
balasan datang lebih dulu dari pesan pembeli, balasan itu tetap terhitung begitu prospeknya dibuat. Tombol "Sudah
dihubungi" di Prospek tidak dihitung sebagai balasan. Pesan yang dihapus, diedit, atau reaksi juga tidak.

**Risiko pesan otomatis**: aplikasi WhatsApp Business bisa mengirim *pesan sambutan* dan *pesan di luar jam kerja*
secara otomatis. Echo-nya (`smb_message_echoes`) **tidak** punya tanda pembeda dari pesan yang diketik sales
(dicek di referensi webhook Meta, 6 Nov 2026: hanya `from`, `to`, `id`, `timestamp`, `type`). Karena itu CRM
menganggap pesan keluar dalam **5 detik** sesudah pesan pembeli sebagai pesan otomatis dan tidak menghitungnya.
Angka ini diatur di `app_settings.wa_auto_reply_seconds`. Pesan otomatis yang datang lebih lambat dari itu tetap
terhitung sebagai balasan; kalau sales memakai pesan sambutan, cek angkanya pada uji pertama.

## Sumber (dibaca 6 Nov 2026)

- Onboarding WhatsApp Business app users (Coexistence):
  https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users
- Embedded Signup, implementasi dan event `WA_EMBEDDED_SIGNUP`:
  https://developers.facebook.com/docs/whatsapp/embedded-signup/implementation
- Langkah Tech Provider sesudah signup (tukar kode, subscribed_apps):
  https://developers.facebook.com/docs/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider
- Webhook `messages` (BSUID `user_id` / `from_user_id`, `wa_id` bisa tidak ada):
  https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/reference/messages
- Webhook `smb_message_echoes`: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/reference/smb_message_echoes
- Webhook `history`: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/reference/history
- Webhook `smb_app_state_sync`: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/reference/smb_app_state_sync

## Untuk developer

- Route: `app/api/v1/webhooks/whatsapp/route.ts` (GET verifikasi, POST tanda tangan `X-Hub-Signature-256` atas
  byte mentah body, lalu `inbound_events`, jawab 200, proses sesudahnya). Logika di `lib/whatsapp/*`. Body > 3 MB
  ditolak (413); 60 kegagalan tanda tangan / verify token per menit dari satu alamat → 429.
- Hanya `wa_lines` dengan mode `coexistence` atau `cloud_api` **dan** `consent_at` terisi yang diproses. Bagian
  webhook untuk nomor lain dibuang **sebelum** disimpan.
- Prospek: chat dari kontak yang belum punya prospek di nomor itu dalam 30 hari, atau chat dari iklan (referral
  `source_id` → `ads.meta_ad_id`, atau kode iklan di teks). Selalu lewat `ingestLead()`; id pesan yang sama dua kali
  tetap satu prospek.
- Tabel: `wa_messages` (metadata), `wa_message_texts` (isi, hanya jika `store_message_text`), `wa_contacts`
  (BSUID ↔ kontak). View `v_wa_response_times`. Migrasi 017.
- Payload di `inbound_events` dipangkas **sebelum** disimpan (`prepareEvent`): hanya id, waktu, jenis, id
  referral iklan, dan kode iklan yang sudah dibaca dari teks (`crm_codes`). Tanpa teks, caption, nama profil,
  username, kartu kontak, status kirim, atau daftar kontak HP (`smb_app_state_sync` dibuang seluruhnya). Hash body
  (`external_id`) menahan kiriman ganda. Teks (hanya untuk nomor yang menyimpan isi) dan nama profil dibawa di
  memori ke proses langsung sesudah respons; tidak pernah ke `leads.first_message`, yang bisa dibaca semua user.
- Event yang gagal terus (poison) tetap hanya berisi payload yang sudah dipangkas; `error` hanya nama error.
- Klaim: proses langsung dan job ulang sama-sama mengambil event dengan `UPDATE … SET claimed_at = now() WHERE
  processed_at IS NULL AND (claimed_at IS NULL OR claimed_at < now() - 5 menit) RETURNING`, jadi satu event tidak
  diproses dua kali bersamaan.
- Ulang otomatis: `jobs/retry-inbound.ts` (setiap 5 menit, event > 2 menit, maksimal 5 kali). Event yang diulang
  dari database tidak punya teks dan nama di memori: pesannya dicatat sebagai metadata saja.
