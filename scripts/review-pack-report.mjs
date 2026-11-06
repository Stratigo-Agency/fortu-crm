// Turns the query results into the review pack (Markdown, Bahasa Indonesia).
// Pure functions: rows in, text out. No database here, so the proposals can be tested with made-up rows.

import { QUERIES } from "./review-pack-queries.mjs";

// ───────── Thresholds for the proposals (printed in the pack, so everyone sees the bar) ─────────
export const RULES = {
  minDeals: 10, // fewer closed / entered deals than this: "data belum cukup"
  minChats: 20, // fewer Meta ad chats than this: "data belum cukup"
  minOpen: 5, // fewer open deals in a stage than this: no stale-days proposal
  probabilityGapPts: 15, // observed share differs from the stage probability by this many points
  staleSharePct: 50, // this share of a stage's open deals is stale
  targetLowPct: 50, // a finished month reached less than this share of its target
  targetHighPct: 120, // ... or more than this
  logMedianMin: 60, // median minutes from chat to CRM above this
  captureLowPct: 70, // share of ad chats that reached the CRM below this
  overLimitSharePct: 30, // share of new deals with a discount above the limit
  lostTopSharePct: 40, // one lost reason is at least this share of lost deals
};

// ───────── Words ─────────
const SOURCE = {
  meta_ctwa: "Iklan Meta / WA", meta_leadform: "Form iklan Meta", instagram_dm: "Instagram", website_form: "Website",
  website_wa_link: "Tombol WA website", google_ads: "Google Ads", referral: "Referral", partner_si: "Partner / SI",
  repeat_order: "Repeat order", event: "Event / pameran", walk_in: "Walk-in / telepon", tender: "Tender",
  whatsapp_direct: "WhatsApp langsung", other: "Lainnya",
};
const LOST = {
  harga: "Harga terlalu tinggi", kompetitor: "Pilih kompetitor", budget: "Budget ditunda", timing: "Waktunya belum tepat",
  no_response: "Tidak ada respon", spec: "Spesifikasi tidak cocok", stock_leadtime: "Stok / waktu kirim", other: "Lainnya",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const MONTHS_LONG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const label = (map, key) => map[key] ?? key ?? "Tanpa isi";

// ───────── Number formats (same look as the app: id-ID, comma decimals) ─────────
const whole = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const upTo = (n) => new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: n });
const num = (v) => (v === null || v === undefined ? null : Number(v));

export const fmtCount = (v) => (num(v) === null ? "-" : whole.format(num(v)));
export const fmtDec = (v) => (num(v) === null ? "-" : upTo(1).format(num(v)));
export const fmtPct = (v) => (num(v) === null ? "-" : `${upTo(1).format(num(v))}%`);

/** Rp540 jt, Rp1,12 M, or whole Rupiah under one million. */
export function fmtRp(v) {
  const n = num(v);
  if (n === null) return "-";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const jt = Math.round(abs / 1e5) / 10;
  if (abs >= 1e9 || jt >= 1000) return `${sign}Rp${upTo(2).format(Math.round(abs / 1e7) / 100)} M`;
  if (abs >= 1e6) return `${sign}Rp${upTo(1).format(jt)} jt`;
  return `${sign}Rp${whole.format(Math.round(abs))}`;
}

/** Minutes as "12 menit" or "2,5 jam" or "1,3 hari". */
export function fmtMinutes(v) {
  const n = num(v);
  if (n === null) return "-";
  if (n < 90) return `${upTo(1).format(n)} menit`;
  if (n < 60 * 36) return `${upTo(1).format(n / 60)} jam`;
  return `${upTo(1).format(n / 1440)} hari`;
}

/** 2026-11-11 -> 11 Nov 2026 */
export function fmtDay(s) {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** 2026-11-01 -> November 2026 */
const fmtMonth = (s) => {
  const [y, m] = s.slice(0, 10).split("-").map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
};

function table(headers, rows, { text = false } = {}) {
  if (rows.length === 0) return "_Belum ada data._\n";
  const esc = (c) => String(c ?? "-").replaceAll("|", "\\|").replaceAll("\n", " ");
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map((_, i) => (text || i === 0 ? "---" : "---:")).join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
    "",
  ].join("\n");
}

const repName = (r) => (r.is_total ? "Semua sales" : (r.rep ?? "Belum ada pemilik"));

// ───────── Proposals ─────────
/** "data belum cukup" row. */
const thin = (area, current, have, need, unit) => ({
  area,
  current,
  proposal: "Data belum cukup",
  support: `Baru ${fmtCount(have)} ${unit}, perlu minimal ${fmtCount(need)}.`,
});

/**
 * Proposed changes, each tied to the number that supports it. Nothing here is applied anywhere.
 * `r` is the object returned by runQueries().
 */
export function buildProposals(r) {
  const out = [];
  const settings = Object.fromEntries((r.rule_settings ?? []).map((s) => [s.key, s.value]));
  const staleBy = Object.fromEntries((r.stale_by_stage ?? []).map((s) => [s.key, s]));
  const conv = Object.fromEntries((r.stage_conversion ?? []).map((s) => [s.key, s]));

  // 1. Stage probabilities
  for (const s of r.stage_outcomes ?? []) {
    const area = `Peluang tahap ${s.name}`;
    const current = `${fmtPct(num(s.probability) * 100)}`;
    if (s.closed < RULES.minDeals) {
      out.push(thin(area, current, s.closed, RULES.minDeals, "deal yang sudah selesai (Done deal atau Lost) dan pernah lewat tahap ini"));
      continue;
    }
    const gap = num(s.win_pct_of_closed) - num(s.probability) * 100;
    if (Math.abs(gap) >= RULES.probabilityGapPts) {
      const suggested = Math.round(num(s.win_pct_of_closed) / 5) * 5;
      out.push({
        area, current,
        proposal: `Pertimbangkan ${fmtPct(suggested)}`,
        support: `Dari ${fmtCount(s.closed)} deal yang sudah selesai dan pernah lewat tahap ini, ${fmtCount(s.later_won)} jadi Done deal (${fmtPct(s.win_pct_of_closed)}).`,
      });
    } else {
      out.push({
        area, current, proposal: "Tidak perlu diubah",
        support: `Hasil nyata ${fmtPct(s.win_pct_of_closed)} dari ${fmtCount(s.closed)} deal selesai, selisih kurang dari ${RULES.probabilityGapPts} poin.`,
      });
    }
  }

  // 2. Stale days
  for (const s of r.stage_outcomes ?? []) {
    const area = `Batas hari belum bergerak, tahap ${s.name}`;
    const current = `${fmtCount(s.stale_after_days)} hari`;
    const st = staleBy[s.key];
    const c = conv[s.key];
    if (!st || st.open_deals < RULES.minOpen) {
      out.push(thin(area, current, st?.open_deals ?? 0, RULES.minOpen, "deal terbuka di tahap ini"));
      continue;
    }
    const share = (st.stale_deals * 100) / st.open_deals;
    const median = c?.entered >= RULES.minDeals ? num(c.median_days_in_stage) : null;
    const tooTightByShare = share >= RULES.staleSharePct;
    const tooTightByMedian = median !== null && median > num(s.stale_after_days);
    if (tooTightByShare || tooTightByMedian) {
      const suggested = tooTightByMedian ? Math.ceil(median) : num(s.stale_after_days) + 3;
      out.push({
        area, current,
        proposal: `Pertimbangkan ${fmtCount(suggested)} hari`,
        support: `${fmtCount(st.stale_deals)} dari ${fmtCount(st.open_deals)} deal terbuka (${fmtPct(share)}) sudah lewat batas`
          + (median !== null ? `; deal biasanya ${fmtDec(median)} hari di tahap ini (median, ${fmtCount(c.entered)} deal).` : "."),
      });
    } else {
      out.push({
        area, current, proposal: "Tidak perlu diubah",
        support: `${fmtCount(st.stale_deals)} dari ${fmtCount(st.open_deals)} deal terbuka (${fmtPct(share)}) lewat batas`
          + (median !== null ? `; median ${fmtDec(median)} hari di tahap ini.` : "."),
      });
    }
  }

  // 3. Targets (company row of each finished month)
  const finished = (r.targets ?? []).filter((t) => t.is_company && t.month_over);
  if (finished.length === 0) {
    out.push({
      area: "Target bulanan", current: "-", proposal: "Data belum cukup",
      support: "Belum ada bulan penuh dengan target perusahaan di periode ini.",
    });
  } else {
    for (const t of finished) {
      const month = fmtMonth(t.month);
      for (const [kind, pct, target, got, show] of [
        ["Rupiah", t.amount_pct, t.target_amount, t.amount_won, fmtRp],
        ["unit layar", t.units_pct, t.target_units, t.units_won, fmtCount],
      ]) {
        if (pct === null) continue;
        const area = `Target ${kind}, ${month}`;
        const support = `Tercapai ${show(got)} dari target ${show(target)} (${fmtPct(pct)}).`;
        if (num(pct) < RULES.targetLowPct) out.push({ area, current: show(target), proposal: "Bahas apakah target terlalu tinggi", support });
        else if (num(pct) > RULES.targetHighPct) out.push({ area, current: show(target), proposal: "Bahas apakah target bisa dinaikkan", support });
        else out.push({ area, current: show(target), proposal: "Tidak perlu diubah", support });
      }
    }
  }

  // 4. Rules
  const disc = r.discount_summary?.[0];
  if (!disc || disc.deals_created < RULES.minDeals) {
    out.push(thin(`Batas diskon (sekarang ${settings.max_discount_pct ?? "?"}%)`, `${settings.max_discount_pct ?? "?"}%`, disc?.deals_created ?? 0, RULES.minDeals, "deal baru di periode ini"));
  } else {
    const share = (disc.over_limit_deals * 100) / disc.deals_created;
    const cur = `${settings.max_discount_pct}%`;
    out.push({
      area: "Batas diskon", current: cur,
      proposal: share >= RULES.overLimitSharePct ? "Bahas apakah batas terlalu ketat, atau tetap dengan persetujuan CEO" : "Tidak perlu diubah",
      support: `${fmtCount(disc.over_limit_deals)} dari ${fmtCount(disc.deals_created)} deal baru (${fmtPct(share)}) punya diskon di atas batas; ${fmtCount(disc.approved)} disetujui di periode ini.`,
    });
  }

  const total = (r.time_to_log ?? []).find((x) => x.is_total);
  if (!total || total.leads < RULES.minDeals) {
    out.push(thin("Aturan catat chat", "Belum ada batas waktu", total?.leads ?? 0, RULES.minDeals, "lead di periode ini"));
  } else if (num(total.median_min) > RULES.logMedianMin) {
    out.push({
      area: "Aturan catat chat", current: "Belum ada batas waktu",
      proposal: `Usulkan batas catat, misalnya ${RULES.logMedianMin} menit sejak chat masuk`,
      support: `Median ${fmtMinutes(total.median_min)} dari chat masuk sampai dicatat (${fmtCount(total.leads)} lead); ${fmtCount(total.over_60min)} lead lebih dari 60 menit.`,
    });
  } else {
    out.push({
      area: "Aturan catat chat", current: "Belum ada batas waktu", proposal: "Tidak perlu diubah",
      support: `Median ${fmtMinutes(total.median_min)} dari chat masuk sampai dicatat (${fmtCount(total.leads)} lead).`,
    });
  }

  const ads = r.ads_capture?.[0];
  if (!ads || ads.meta_chats < RULES.minChats) {
    out.push(thin("Aturan kode iklan di chat", "Kode iklan di pesan pertama", ads?.meta_chats ?? 0, RULES.minChats, "chat iklan dari Meta"));
  } else if (num(ads.capture_pct) < RULES.captureLowPct) {
    out.push({
      area: "Aturan kode iklan di chat", current: "Kode iklan di pesan pertama",
      proposal: "Pastikan semua iklan memakai kode, dan sales mencatat kode itu",
      support: `${fmtCount(ads.leads_with_ad)} dari ${fmtCount(ads.meta_chats)} chat iklan tercatat dengan iklannya (${fmtPct(ads.capture_pct)}); ${fmtCount(ads.ctwa_without_ad)} lead iklan tanpa kode.`,
    });
  } else {
    out.push({
      area: "Aturan kode iklan di chat", current: "Kode iklan di pesan pertama", proposal: "Tidak perlu diubah",
      support: `${fmtCount(ads.leads_with_ad)} dari ${fmtCount(ads.meta_chats)} chat iklan tercatat (${fmtPct(ads.capture_pct)}).`,
    });
  }

  const lostTotal = (r.lost_reasons ?? []).reduce((a, x) => a + x.deals, 0);
  const top = (r.lost_reasons ?? [])[0];
  if (lostTotal < RULES.minDeals) {
    out.push(thin("Tindak lanjut alasan lost", "-", lostTotal, RULES.minDeals, "deal Lost di periode ini"));
  } else if (num(top.share_pct) >= RULES.lostTopSharePct) {
    out.push({
      area: "Tindak lanjut alasan lost", current: "-",
      proposal: `Bahas langkah khusus untuk "${label(LOST, top.reason)}"`,
      support: `${fmtCount(top.deals)} dari ${fmtCount(lostTotal)} deal Lost (${fmtPct(top.share_pct)}) karena ${label(LOST, top.reason).toLowerCase()}.`,
    });
  } else {
    out.push({
      area: "Tindak lanjut alasan lost", current: "-", proposal: "Tidak perlu diubah",
      support: `Alasan terbanyak "${label(LOST, top.reason).toLowerCase()}" hanya ${fmtPct(top.share_pct)} dari ${fmtCount(lostTotal)} deal Lost.`,
    });
  }

  return out;
}

// ───────── The pack ─────────
/**
 * @param results rows from runQueries()
 * @param opts { from, to, generatedAt: string, banner?: string }
 */
export function renderReport(results, { from, to, generatedAt, banner }) {
  const r = results;
  const L = [];
  const push = (...s) => L.push(...s);

  push("# Review 3 minggu Fortu CRM", "");
  if (banner) push(`> **${banner}**`, "");
  push(`Periode: ${fmtDay(from)} sampai ${fmtDay(to)}. Dibuat ${generatedAt}.`);
  push("Semua angka Rupiah sebelum PPN. Waktu memakai jam Jakarta (WIB).");
  push("Setiap angka punya query SQL-nya di Lampiran, di bagian paling bawah.", "");

  // Ringkasan
  const leadTotal = r.leads_by_source.find((x) => x.is_total);
  const winTotal = r.win_rate.find((x) => x.is_total);
  const logTotal = r.time_to_log.find((x) => x.is_total);
  const ads = r.ads_capture[0];
  const co = (r.targets ?? []).filter((t) => t.is_company);
  push("## Ringkasan", "");
  push(`- Lead masuk: ${fmtCount(leadTotal?.leads ?? 0)}.`);
  push(`- Waktu dari chat masuk sampai dicatat (median): ${fmtMinutes(logTotal?.median_min)}.`);
  push(`- Deal selesai: ${fmtCount(winTotal?.won ?? 0)} Done deal dan ${fmtCount(winTotal?.lost ?? 0)} Lost. Win rate ${fmtPct(winTotal?.win_rate_pct)}.`);
  push(`- Nilai Done deal di periode ini: ${fmtRp(winTotal?.won_amount ?? 0)}.`);
  push(`- Chat iklan yang tercatat di CRM: ${ads.capture_pct === null ? "belum ada data iklan" : `${fmtPct(ads.capture_pct)} (${fmtCount(ads.leads_with_ad)} dari ${fmtCount(ads.meta_chats)})`}.`);
  if (co.length > 0) push(`- Target ${co.map((t) => fmtMonth(t.month)).join(", ")}: lihat bagian 4.`);
  push("");

  // 1. Lead
  push("## 1. Lead masuk", "");
  push("### Per sumber", "");
  push(table(["Sumber", "Lead"], r.leads_by_source.map((x) => [x.is_total ? "Semua sumber" : label(SOURCE, x.source), fmtCount(x.leads)])));
  push("### Per sales", "");
  push(table(["Sales", "Lead", "Jadi deal"], r.leads_by_rep.map((x) => [repName(x), fmtCount(x.leads), fmtCount(x.became_deal)])));
  push("### Waktu dari chat masuk sampai dicatat", "");
  push("Tanggal dan jam chat masuk diisi sales saat mencatat, jadi angka ini menunjukkan seberapa cepat chat dicatat.", "");
  push(table(
    ["Sales", "Lead", "Median", "9 dari 10 lead dalam", "Lebih dari 60 menit"],
    r.time_to_log.map((x) => [repName(x), fmtCount(x.leads), fmtMinutes(x.median_min), fmtMinutes(x.p90_min), fmtCount(x.over_60min)]),
  ));

  // 2. Pipeline
  push("## 2. Pipeline", "");
  push("### Konversi dan lama di tiap tahap", "");
  push("Dihitung dari semua deal sejak CRM dipakai, bukan hanya periode ini. \"Lanjut\" = deal yang pindah ke tahap berikutnya, dari deal yang sudah meninggalkan tahap itu.", "");
  push(table(
    ["Tahap", "Pernah masuk", "Lanjut", "Lost di sini", "Masih di sini", "Lanjut (%)", "Lama di tahap (median)"],
    r.stage_conversion.map((x) => [x.name, fmtCount(x.entered), fmtCount(x.moved_on), fmtCount(x.lost_here), fmtCount(x.still_here), fmtPct(x.moved_on_pct), x.median_days_in_stage === null ? "-" : `${fmtDec(x.median_days_in_stage)} hari`]),
  ));
  push("### Win rate", "");
  push("Dari deal yang selesai (Done deal atau Lost) di periode ini, berdasarkan tanggal selesai.", "");
  push(table(
    ["Sales", "Done deal", "Lost", "Win rate", "Nilai Done deal"],
    r.win_rate.map((x) => [repName(x), fmtCount(x.won), fmtCount(x.lost), fmtPct(x.win_rate_pct), fmtRp(x.won_amount)]),
  ));
  push("### Alasan lost", "");
  push(table(["Alasan", "Deal", "Nilai", "Bagian"], r.lost_reasons.map((x) => [label(LOST, x.reason), fmtCount(x.deals), fmtRp(x.amount), fmtPct(x.share_pct)])));
  push("### Diskon", "");
  const disc = r.discount_summary[0];
  push(`- Diskon disetujui di periode ini: ${fmtCount(disc.approved)} deal.`);
  push(`- Deal baru dengan diskon di atas batas: ${fmtCount(disc.over_limit_deals)} dari ${fmtCount(disc.deals_created)}.`);
  push(`- Menunggu persetujuan sekarang: ${fmtCount(disc.waiting_now)} deal.`, "");
  push(table(
    ["Deal", "Sales", "Tahap", "Nilai", "Diskon terbesar", "Batas", "Disetujui oleh", "Tanggal"],
    r.discounts_approved.map((x) => [x.deal, x.rep, x.stage_name, fmtRp(x.amount), fmtPct(x.max_discount_pct), fmtPct(x.limit_pct), x.approved_by ?? "-", fmtDay(x.approved_on)]),
  ));

  // 3. Ads
  push("## 3. Iklan ke CRM", "");
  push("Chat iklan menurut Meta dibandingkan dengan lead di CRM yang tercatat dengan iklannya (kode iklan).", "");
  push(table(
    ["Chat iklan (Meta)", "Lead dengan iklan di CRM", "Tercatat", "Lead iklan tanpa kode"],
    [[fmtCount(ads.meta_chats), fmtCount(ads.leads_with_ad), fmtPct(ads.capture_pct), fmtCount(ads.ctwa_without_ad)]],
  ));
  push("Iklan yang paling banyak belum tercatat:", "");
  push(table(
    ["Iklan", "Kode", "Chat (Meta)", "Lead di CRM", "Belum tercatat"],
    r.ads_capture_by_ad.map((x) => [x.ad_name, x.ad_code ?? "-", fmtCount(x.meta_chats), fmtCount(x.leads_with_ad), fmtCount(x.missing)]),
  ));

  // 4/5. Targets
  push("## 4. Target dan hasil", "");
  push("Dihitung per bulan penuh, bukan hanya hari di periode ini. Unit = layar yang masuk hitungan target.", "");
  push(table(
    ["Bulan", "Siapa", "Unit", "Target unit", "Unit (%)", "Done deal", "Target Rupiah", "Rupiah (%)"],
    r.targets.map((x) => [
      `${fmtMonth(x.month)}${x.month_over ? "" : " (berjalan)"}`, x.is_company ? "Perusahaan" : (x.rep ?? "-"),
      fmtCount(x.units_won), fmtCount(x.target_units), fmtPct(x.units_pct), fmtRp(x.amount_won), fmtRp(x.target_amount), fmtPct(x.amount_pct),
    ]),
  ));

  // 5. Proposals
  const proposals = buildProposals(r);
  push("## 5. Usulan perubahan", "");
  push("**Ini usulan saja. Belum ada yang diubah di CRM.** Kita putuskan bersama di review.", "");
  push(`Usulan hanya muncul kalau datanya cukup: minimal ${RULES.minDeals} deal (atau lead) untuk tiap hitungan, ${RULES.minChats} chat iklan untuk iklan, dan ${RULES.minOpen} deal terbuka untuk batas hari. Kalau kurang, tertulis "Data belum cukup".`, "");
  push(table(["Bagian", "Sekarang", "Usulan", "Angka pendukung"], proposals.map((p) => [p.area, p.current, p.proposal, p.support]), { text: true }));
  push(
    "Batas yang dipakai untuk memunculkan usulan:",
    `- Peluang tahap: hasil nyata berbeda ${RULES.probabilityGapPts} poin atau lebih dari peluang sekarang.`,
    `- Batas hari belum bergerak: ${RULES.staleSharePct}% atau lebih deal terbuka sudah lewat batas, atau median lama di tahap lebih besar dari batas.`,
    `- Target: bulan penuh tercapai kurang dari ${RULES.targetLowPct}% atau lebih dari ${RULES.targetHighPct}%.`,
    `- Diskon: ${RULES.overLimitSharePct}% atau lebih deal baru di atas batas diskon.`,
    `- Catat chat: median lebih dari ${RULES.logMedianMin} menit. Kode iklan: kurang dari ${RULES.captureLowPct}% tercatat.`,
    `- Alasan lost: satu alasan ${RULES.lostTopSharePct}% atau lebih dari deal Lost.`,
    "",
  );

  // Appendix
  push("## Lampiran: SQL untuk setiap angka", "");
  push("Buka satu per satu. Query ini hanya membaca data (SELECT).", "");
  const period = { from, to };
  for (const q of QUERIES) {
    const values = q.params.length === 0 ? "tanpa parameter (semua data)" : q.params.map((p, i) => `$${i + 1} = ${period[p]}`).join(", ");
    push(`<details>`, `<summary>${q.title} (${q.id})</summary>`, "", `Parameter: ${values}`, "", "```sql", q.sql.trim(), "```", "", "</details>", "");
  }

  return `${L.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
