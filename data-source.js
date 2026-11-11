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
    return { ov: ov, bills: bills, order: order, names: names, generated: ov.updated, settings: S, live: true, projects: buildProjects(raw, order) };
  }

  // Projects (e.g. new elevators): per-apartment shares and installments.
  function buildProjects(raw, order) {
    var shares = raw.project_shares || [], pays = {}, priv = {};
    (raw.project_payments || []).forEach(function (p) { (pays[p.share_id] = pays[p.share_id] || []).push(p); });
    (raw.project_share_private || []).forEach(function (p) { priv[p.share_id] = p; });
    return (raw.projects || []).slice().sort(function (a, b) { return (a.ord - b.ord) || (a.id - b.id); }).map(function (pr) {
      var byApt = {}, groups = {}, tot = { due: 0, paid: 0, outstanding: 0, overpaid: 0, nFull: 0, nPart: 0, nNone: 0, n: 0, signed: 0 };
      shares.filter(function (s) { return s.project_id === pr.id; }).forEach(function (s) {
        var ps = (pays[s.id] || []).slice().sort(function (a, b) { return a.paid_at.localeCompare(b.paid_at); });
        var paid = r2(ps.reduce(function (t, p) { return t + (+p.amount); }, 0)), due = r2(+s.share - (+s.credit || 0)), left = r2(due - paid);
        var st = left <= 1 ? (left < -1 ? "over" : "paid") : (paid > 0 ? "partial" : "unpaid");
        var x = { id: s.id, apt: s.apt, grp: s.grp || "", share: +s.share, credit: +s.credit || 0, creditNote: s.credit_note || "", signed: !!s.signed,
          due: due, paid: paid, left: left, status: st, payments: ps, lastPaid: ps.length ? ps[ps.length - 1].paid_at : "",
          protocol: priv[s.id] ? priv[s.id].protocol_amount : null, note: priv[s.id] ? priv[s.id].note : null };
        byApt[s.apt] = x;
        var g = groups[x.grp] = groups[x.grp] || { name: x.grp, n: 0, share: x.share, due: 0, paid: 0 };
        g.n++; g.due += due; g.paid += Math.min(paid, due);
        tot.n++; tot.due += due; tot.paid += paid; if (left > 1) tot.outstanding += left; if (left < -1) tot.overpaid -= left;
        if (st === "paid" || st === "over") tot.nFull++; else if (st === "partial") tot.nPart++; else tot.nNone++;
        if (x.signed) tot.signed++;
      });
      var ex = (raw.project_expenses || []).filter(function (e) { return e.project_id === pr.id; }).map(function (e) { return { id: e.id, date: e.date, amount: +e.amount, note: e.note || "" }; })
        .sort(function (a, b) { return b.date.localeCompare(a.date); });
      var spent = r2(ex.reduce(function (t, e) { return t + e.amount; }, 0));
      Object.keys(tot).forEach(function (k) { tot[k] = r2(tot[k]); });
      tot.collected = r2(tot.due - tot.outstanding); // counted towards shares (overpayments excluded)
      tot.pct = tot.due ? Math.min(100, Math.round(tot.collected / tot.due * 1000) / 10) : 0;
      return { id: pr.id, title: pr.title, description: pr.description || "", totalCost: pr.total_cost == null ? null : +pr.total_cost, costNote: pr.cost_note || "",
        status: pr.status, start: pr.start_date || "", deadline: pr.deadline || "", shares: byApt,
        order: order.filter(function (a) { return byApt[a]; }), others: order.filter(function (a) { return !byApt[a]; }),
        groups: Object.keys(groups).sort().map(function (k) { var g = groups[k]; g.due = r2(g.due); g.paid = r2(g.paid); return g; }),
        totals: tot, expenses: ex, spent: spent, cash: r2(tot.paid - spent) };
    });
  }
  window.buildProjects = buildProjects;

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
        rest("payments", "select=bill_id,amount,paid_at,created_at"),
        rest("notices", "select=date,title,body&order=date.desc,id.desc&limit=30"),
        rest("expenses", "select=date,type,category,amount,note"),
        rest("projects", "select=*").catch(function () { return []; }),
        rest("project_shares", "select=*").catch(function () { return []; }),
        rest("project_payments", "select=id,share_id,amount,paid_at,method,created_at").catch(function () { return []; }),
        rest("project_expenses", "select=*").catch(function () { return []; })
      ]).then(function (r) {
        return buildData({ settings: r[0], apartments: r[1], bills: r[2], payments: r[3], notices: r[4], expenses: r[5],
          projects: r[6], project_shares: r[7], project_payments: r[8], project_expenses: r[9] });
      }).catch(function (e) {
        console.warn("Live data unavailable, using saved copy:", e);
        return fetch("data.json?v=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.json(); });
      });
    }
    return fetch("data.json?v=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw 0; return r.json(); });
  };
})();
