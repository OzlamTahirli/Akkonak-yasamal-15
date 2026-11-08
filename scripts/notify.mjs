// Sends push notifications through OneSignal.
//   node scripts/notify.mjs push   -> after data.json changes: "bills ready" for a new month + new announcements
//   node scripts/notify.mjs daily  -> personal reminders to unpaid apartments (3 days before due, and on the due day)
// Env: ONESIGNAL_APP_ID, ONESIGNAL_REST_KEY, SITE_URL. DRY_RUN=1 prints instead of sending.
import fs from "node:fs";
import { execSync } from "node:child_process";

const APP_ID = process.env.ONESIGNAL_APP_ID || "";
const KEY = process.env.ONESIGNAL_REST_KEY || "";
const SITE = (process.env.SITE_URL || "").replace(/\/?$/, "/");
const DRY = process.env.DRY_RUN === "1";
const mode = process.argv[2] || "push";
const TODAY = process.env.TODAY || new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10); // Asia/Baku (UTC+4)

if (!DRY && (!APP_ID || !KEY)) { console.log("OneSignal is not configured yet — nothing sent."); process.exit(0); }

const MON = ["Yanvar","Fevral","Mart","Aprel","May","İyun","İyul","Avqust","Sentyabr","Oktyabr","Noyabr","Dekabr"];
const pLabel = (p) => MON[+p.slice(5, 7) - 1] + " " + p.slice(0, 4);
const dLabel = (d) => (+d.slice(8, 10)) + " " + MON[+d.slice(5, 7) - 1];
const money = (n) => (Math.round(n * 100) / 100).toFixed(2) + " ₼";
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

const data = JSON.parse(fs.readFileSync("data.json", "utf8"));
const building = data.ov.building || "MMMC";
const latestPeriod = (d) => Object.values(d.bills).flat().map((b) => b.period).sort().pop() || "";

let sent = 0, failed = 0;
async function send({ title, body, url, apt }) {
  const payload = {
    app_id: APP_ID, target_channel: "push",
    headings: { en: title }, contents: { en: body },
    url: url || SITE || undefined,
    ...(apt ? { filters: [{ field: "tag", key: "apt", relation: "=", value: String(apt) }] } : { included_segments: ["Subscribed Users"] }),
  };
  if (DRY) { console.log("[dry-run]", JSON.stringify({ title, body, url: payload.url, to: apt ? "apt " + apt : "everyone" })); sent++; return; }
  const r = await fetch("https://api.onesignal.com/notifications?c=push", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Key " + KEY }, body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (r.ok && !j.errors) sent++; else { failed++; console.error("OneSignal error", r.status, JSON.stringify(j)); }
}

if (mode === "push") {
  let prev = null;
  try { prev = JSON.parse(execSync("git show HEAD~1:data.json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); } catch {}
  const lp = latestPeriod(data);
  if (lp && (!prev || latestPeriod(prev) !== lp)) {
    const due = Object.values(data.bills).flat().filter((b) => b.period === lp).map((b) => b.due).sort()[0];
    await send({ title: `${building}: ${pLabel(lp)} hesabları hazırdır`, body: `Hesabınıza baxın${due ? ` · son tarix ${dLabel(due)}` : ""}.`, url: SITE });
  }
  const key = (n) => n.date + "|" + n.title;
  const old = new Set((prev?.ov?.notices || []).map(key));
  if (prev) for (const n of data.ov.notices || []) {
    if (!old.has(key(n)) && !/hesabları hazırdır/i.test(n.title)) await send({ title: `📣 ${n.title}`, body: (n.body || "").slice(0, 180), url: SITE });
  }
} else if (mode === "daily") {
  for (const [apt, list] of Object.entries(data.bills)) {
    const left = (b) => Math.max(0, (b.total || 0) - (b.paid || 0));
    const hits = list.filter((b) => left(b) > 0.005 && b.due && (b.due === TODAY || addDays(b.due, -3) === TODAY));
    if (!hits.length) continue;
    const owe = list.reduce((s, b) => s + left(b), 0);
    const today = hits.some((b) => b.due === TODAY);
    await send({
      apt,
      title: today ? `Bu gün son ödəniş günüdür — mənzil ${apt}` : `Ödəniş xatırlatması — mənzil ${apt}`,
      body: `Ödənilməli məbləğ: ${money(owe)} · son tarix ${dLabel(hits[0].due)}.`,
      url: SITE ? SITE + "#bill-" + encodeURIComponent(apt) : undefined,
    });
  }
}
console.log(`mode=${mode} today=${TODAY} sent=${sent} failed=${failed}`);
if (failed) process.exitCode = 1;
