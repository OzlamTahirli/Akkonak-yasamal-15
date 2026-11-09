// Loads live data from Supabase (if configured in config.js), otherwise falls back to data.json.
// Produces the same DATA shape the site already uses: { ov, bills: {apt: [...]}, order, names, generated }.
(function () {
  function pad(n) { return ("0" + n).slice(-2); }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addMonths(p, n) { var y = +p.slice(0, 4), m = +p.slice(5, 7) + n; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y + "-" + pad(m); }
  function r2(n) { return Math.round((+n || 0) * 100) / 100; }
  function num(v) { return v == null ? null : +v; }

  function buildData(raw) {
    var S = {}; (raw.settings || []).forEach(function (s) { S[s.key] = s.value; });
    var apts = (raw.apartments || []).slice().sort(function (a, b) { return a.ord - b.ord; });
    var order = apts.map(function (a) { return a.apt; });
    var names = {}; apts.forEach(function (a) { if (a.name) names[a.apt] = a.name; });
    var pays = {}; (raw.payments || []).forEach(function (p) { (pays[p.bill_id] = pays[p.bill_id] || []).push(p); });
    var td = today(), cp = td.slice(0, 7);
    var bills = {}, all = [];
    (raw.bills || []).forEach(function (b) {
      var ps = pays[b.id] || [];
      var paid = r2(ps.reduce(function (s, p) { return s + (+p.amount); }, 0));
      var paidDate = ps.map(function (p) { return p.paid_at; }).sort().pop() || "";
      var total = r2(b.total), left = r2(Math.max(0, total - paid));
      var x = {
        id: b.id, period: b.period, apt: b.apt, kommunal: +b.kommunal, prev: num(b.prev), cur: num(b.cur), tariff: +b.tariff,
        kwh: (b.prev != null && b.cur != null) ? Math.round((b.cur - b.prev) * 10) / 10 : null,
        elec: +b.elec, parking: +b.parking, extra: +b.extra, extraNote: b.extra_note || "",
        total: total, paid: paid, paidDate: paidDate, left: left, due: b.due || "",
        status: left <= 0.005 ? "paid" : (b.due && b.due < td ? "overdue" : (paid > 0 ? "partial" : "unpaid")),
        payments: ps
      };
      (bills[b.apt] = bills[b.apt] || []).push(x); all.push(x);
    });
    Object.keys(bills).forEach(function (k) { bills[k].sort(function (a, b) { return b.period.localeCompare(a.period); }); });

    var periods = all.map(function (b) { return b.period; }).filter(function (p, i, a) { return p <= cp && a.indexOf(p) === i; }).sort();
    var lp = periods.length ? periods[periods.length - 1] : cp;
    var cur = all.filter(function (b) { return b.period === lp; });
    var monthly = {}; function add(p, k, v) { if (!p) return; monthly[p] = monthly[p] || { inc: 0, exp: 0 }; monthly[p][k] += v; }
    var feeIncome = 0;
    (raw.payments || []).forEach(function (p) { feeIncome += +p.amount; add((p.paid_at || "").slice(0, 7), "inc", +p.amount); });
    var oInc = 0, oExp = 0, cats = {}, c12 = addMonths(cp, -11), expMonth = 0;
    var ex = (raw.expenses || []).map(function (e) { return { date: e.date, income: e.type === "income", category: e.category || "—", amount: +e.amount, note: e.note || "" }; });
    ex.forEach(function (x) {
      var p = x.date.slice(0, 7);
      if (x.income) { oInc += x.amount; add(p, "inc", x.amount); }
      else { oExp += x.amount; add(p, "exp", x.amount); if (p >= c12) cats[x.category] = (cats[x.category] || 0) + x.amount; if (p === cp) expMonth += x.amount; }
    });
    var last6 = []; for (var i = 5; i >= 0; i--) { var p = addMonths(cp, -i), m = monthly[p] || { inc: 0, exp: 0 }; last6.push({ period: p, inc: r2(m.inc), exp: r2(m.exp) }); }
    var debt = {}; all.forEach(function (b) { if (b.status === "overdue") debt[b.apt] = 1; });
    var now = new Date();
    var ov = {
      building: S.building_name || "Yasamal-15 MMMC", currency: S.currency || "₼", payInfo: S.pay_info || "", period: lp,
      balance: r2((+S.opening_balance || 0) + feeIncome + oInc - oExp),
      billed: r2(cur.reduce(function (s, b) { return s + b.total; }, 0)),
      collected: r2(cur.reduce(function (s, b) { return s + Math.min(b.paid, b.total); }, 0)),
      paidCount: cur.filter(function (b) { return b.status === "paid"; }).length, billCount: cur.length,
      outstanding: r2(all.reduce(function (s, b) { return s + b.left; }, 0)), debtors: Object.keys(debt).length,
      expMonth: r2(expMonth), monthly: last6,
      categories: Object.keys(cats).map(function (k) { return { name: k, amount: r2(cats[k]) }; }).sort(function (a, b) { return b.amount - a.amount; }),
      recent: ex.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 8),
      notices: (raw.notices || []).map(function (n) { return { date: n.date, title: n.title, body: n.body || "" }; }),
      apartments: order,
      updated: now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + " " + pad(now.getHours()) + ":" + pad(now.getMinutes())
    };
    return { ov: ov, bills: bills, order: order, names: names, generated: ov.updated, settings: S, live: true };
  }

  function rest(table, query) {
    return fetch(window.SUPABASE_URL + "/rest/v1/" + table + "?" + query, {
      headers: { apikey: window.SUPABASE_ANON_KEY, Authorization: "Bearer " + window.SUPABASE_ANON_KEY }, cache: "no-store"
    }).then(function (r) { if (!r.ok) throw new Error(table + " " + r.status); return r.json(); });
  }

  window.buildData = buildData;
  window.loadData = function () {
    if (window.SUPABASE_URL && window.SUPABASE_ANON_KEY) {
      return Promise.all([
        rest("settings", "select=key,value"),
        rest("apartments", "select=*&order=ord"),
        rest("bills", "select=*&order=period"),
        rest("payments", "select=bill_id,amount,paid_at"),
        rest("notices", "select=date,title,body&order=date.desc,id.desc&limit=30"),
        rest("expenses", "select=date,type,category,amount,note")
      ]).then(function (r) {
        return buildData({ settings: r[0], apartments: r[1], bills: r[2], payments: r[3], notices: r[4], expenses: r[5] });
      }).catch(function (e) {
        console.warn("Live data unavailable, using saved copy:", e);
        return fetch("data.json?v=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.json(); });
      });
    }
    return fetch("data.json?v=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw 0; return r.json(); });
  };
})();
