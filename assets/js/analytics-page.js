/* SEMFE Alumni: the «Στατιστικά» page (analytics/).
 *
 * Two parts, from two sources:
 *   1. Επισκεψιμότητα: data/analytics.json, rebuilt every day by
 *      tools/build-analytics.mjs from the site's own visit counter (the
 *      recordVisit Cloud Function) and from Google Analytics. Four periods
 *      (30 days, 90 days, 12 months, everything) chosen in one row of
 *      buttons that scopes every figure of this part.
 *   2. Τα μέλη μας: the members' ANONYMOUS statistics, read live with one
 *      plain request to Firestore (publicStats/members, recounted by the
 *      memberStats Cloud Function whenever an application changes). No
 *      Firebase library, no cookie.
 * A figure whose source has nothing yet is not drawn at all (an empty chart
 * reads as "nobody visits"); a period with no visits says so in words.
 * Every chart is also a table of its numbers, or has one under it, and
 * answers the pointer and the keyboard. Names come from data: they are
 * inserted as text, never as HTML. */
(function () {
  'use strict';
  var app = document.getElementById('analytics-app');
  if (!app) return;
  var A = window.SemfeAuth, C = window.SEMFE || {}, PO = window.SEMFE_PROFILE;
  var root = (A && A.root) || '../';
  var NF = new Intl.NumberFormat('el-GR');
  var PF = new Intl.NumberFormat('el-GR', { style: 'percent', maximumFractionDigits: 0 });
  var MONTHS = ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μαΐ', 'Ιουν', 'Ιουλ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ'];
  var MONTHS_LONG = ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου', 'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'];
  var MONTH_NAMES = ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος', 'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'];
  var WEEKDAYS = ['Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο', 'Κυριακή'];
  var WD_SHORT = ['Δευ', 'Τρί', 'Τετ', 'Πέμ', 'Παρ', 'Σάβ', 'Κυρ'];
  var RANGES = [['30', '30 ημέρες'], ['90', '90 ημέρες'], ['365', '12 μήνες'], ['all', 'Από την αρχή']];
  var CHANNELS = { direct: 'Απευθείας', search: 'Μηχανές αναζήτησης', social: 'Κοινωνικά δίκτυα', email: 'E-mail', other: 'Άλλοι ιστότοποι' };
  var DEVICES = { desktop: 'Υπολογιστής', mobile: 'Κινητό', tablet: 'Tablet' };
  var STAGES = { graduate: 'Απόφοιτοι', 'final-year': 'Τελειόφοιτοι', faculty: 'Μέλη ΔΕΠ' };
  var GENDERS = { female: 'Γυναίκες', male: 'Άνδρες', other: 'Άλλο' };
  var OTHER = 'Λοιπά (ομάδες κάτω από 3 ατόμων)';
  var SRC = { site: 'ο μετρητής του ιστότοπου', ga4: 'Google Analytics' };

  var data = null, members = null, membersState = 'loading', range = '30', drawn = [];
  try { var saved = sessionStorage.getItem('semfeAnRange'); if (saved && /^(30|90|365|all)$/.test(saved)) range = saved; } catch (e) { /* fine */ }

  /* ---------------------------------------------------------------- helpers */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function n(x) { return NF.format(x || 0); }
  function pct(a, b) { return b ? PF.format(a / b) : ''; }
  function dayLong(d) { var p = String(d).split('-'); return (+p[2]) + ' ' + MONTHS_LONG[+p[1] - 1] + ' ' + p[0]; }
  function dayShort(d) { var p = String(d).split('-'); return (+p[2]) + ' ' + MONTHS[+p[1] - 1]; }
  function monthName(m) { var p = String(m).split('-'); return MONTH_NAMES[+p[1] - 1] + ' ' + p[0]; }
  function dec(x) { return (x || 0).toLocaleString('el-GR', { maximumFractionDigits: 1 }); }
  /** "3–9 Μαρτίου 2025", "29 Σεπτεμβρίου – 5 Οκτωβρίου 2025", or across a year end in full. */
  function spanLabel(a, b) {
    if (a === b) return dayLong(a);
    var p = a.split('-'), q = b.split('-');
    if (p[0] !== q[0]) return dayLong(a) + ' – ' + dayLong(b);
    if (p[1] !== q[1]) return (+p[2]) + ' ' + MONTHS_LONG[+p[1] - 1] + ' – ' + dayLong(b);
    return (+p[2]) + '–' + dayLong(b);
  }
  function addDay(d, k) { var x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); }
  function weekStart(d) { var x = new Date(d + 'T00:00:00Z'); return addDay(d, -((x.getUTCDay() + 6) % 7)); }
  /** A long period drawn by week (up to two years) or by month, as the
      average visits per day in each: a part week or month at either end of
      the period then never reads as a fall. Up to 120 days stay daily. */
  function groupDays(rows) {
    if (rows.length <= 120) return rows.map(function (r) { return { by: 'day', d: r.d, last: r.d, days: 1, v: r.v, pv: r.pv, tv: r.v, tpv: r.pv }; });
    var by = rows.length <= 730 ? 'week' : 'month', out = [], cur = null;
    rows.forEach(function (r) {
      var k = by === 'month' ? r.d.slice(0, 7) : weekStart(r.d);
      if (!cur || cur.k !== k) { cur = { k: k, by: by, d: r.d, last: r.d, days: 0, tv: 0, tpv: 0 }; out.push(cur); }
      cur.days++; cur.tv += r.v; cur.tpv += r.pv; cur.last = r.d;
    });
    out.forEach(function (g) { g.v = Math.round(g.tv / g.days * 10) / 10; g.pv = Math.round(g.tpv / g.days * 10) / 10; });
    return out;
  }
  function groupLabel(g) {
    if (g.by === 'month') {
      var full = g.d.slice(8) === '01' && addDay(g.last, 1).slice(8) === '01';
      return monthName(g.d.slice(0, 7)) + (full ? '' : ' (' + spanLabel(g.d, g.last) + ')');
    }
    return g.by === 'week' ? 'Εβδομάδα ' + spanLabel(g.d, g.last) : dayLong(g.d);
  }
  var regionNames = null;
  try { regionNames = new Intl.DisplayNames(['el'], { type: 'region' }); } catch (e) { regionNames = null; }
  function countryLabel(code) {
    if (!code || code === '??' || code === '(not set)') return 'Άγνωστη χώρα';
    if (code === 'XX') return 'Άλλη χώρα';
    var p = PO && PO.countryName(code);
    if (p) return p;
    try { return (regionNames && regionNames.of(code)) || code; } catch (e) { return code; }
  }
  function cityLabel(name) { return PO ? PO.cityName(name) || name : name; }
  function card(title, sub, body, cls) {
    return '<article class="an-card' + (cls ? ' ' + cls : '') + '"><h3>' + esc(title) + '</h3>' + (sub ? '<p class="an-sub">' + sub + '</p>' : '') + body + '</article>';
  }

  /** A list of categories as a table that is also a bar chart: name, bar,
      number, share. Rows: [{ label, n, other }] (already sorted). */
  function bars(rows, opts) {
    opts = opts || {};
    if (!rows || !rows.length) return '<p class="an-empty">' + esc(opts.empty || 'Δεν υπάρχουν ακόμα στοιχεία για αυτή την περίοδο.') + '</p>';
    var max = 0, total = opts.total || 0;
    rows.forEach(function (r) { if (r.n > max) max = r.n; if (!opts.total) total += r.n; });
    return '<div class="an-scroll"><table class="an-bars"><caption class="sr-only">' + esc(opts.caption || '') + '</caption>' +
      '<thead class="sr-only"><tr><th scope="col">' + esc(opts.what || 'Κατηγορία') + '</th><th scope="col">' + esc(opts.unit || 'Αριθμός') + '</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var w = max ? Math.max(1.5, Math.round(r.n / max * 1000) / 10) : 0;
        return '<tr' + (r.other ? ' class="an-other"' : '') + '><th scope="row">' + esc(r.label) + '</th>' +
          '<td><span class="an-barwrap"><span class="an-bar" style="width:' + (w * 0.62) + '%" aria-hidden="true"></span>' +
          '<span class="an-n">' + n(r.n) + '</span>' + (opts.noPct ? '' : '<span class="an-pct">' + pct(r.n, total) + '</span>') + '</span></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /** Where a column chart or a line chart will be drawn once it is on the
      page (it needs its real width). */
  var chartId = 0;
  function chartSlot(kind, payload, label) {
    var id = 'an-chart-' + (++chartId);
    drawn.push({ id: id, kind: kind, payload: payload });
    return '<div class="an-chart" id="' + id + '" role="figure" aria-label="' + esc(label) + '"></div>';
  }

  /* ---------------------------------------------------------- the tooltip */
  var tip = document.createElement('div');
  tip.className = 'an-tip';
  // the same numbers are in each chart's table, so a screen reader is not
  // read every tooltip as well
  tip.setAttribute('aria-hidden', 'true');
  tip.hidden = true;
  document.body.appendChild(tip);
  function showTip(lines, x, y) {
    tip.textContent = '';
    var v = document.createElement('strong');
    v.textContent = lines[0];
    tip.appendChild(v);
    for (var i = 1; i < lines.length; i++) {
      var s = document.createElement('span');
      s.textContent = lines[i];
      tip.appendChild(s);
    }
    tip.hidden = false;
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var left = Math.min(Math.max(8, x + 14), window.innerWidth - w - 8);
    var top = y - h - 12 < 8 ? y + 16 : y - h - 12;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function hideTip() { tip.hidden = true; }
  window.addEventListener('scroll', hideTip, { passive: true });

  /* ---------------------------------------------------------- the charts */
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function niceMax(v) {
    if (v <= 4) return 4;
    var p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }
  /* the frame every chart shares: recessive gridlines and their numbers */
  function frame(svg, W, H, pad, max) {
    for (var i = 0; i <= 4; i++) {
      var val = max * i / 4, y = pad.t + (H - pad.t - pad.b) * (1 - i / 4);
      svg.appendChild(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: i ? 'an-gridline' : 'an-baseline' }));
      if (Math.round(val) === val) {
        var t = svgEl('text', { x: pad.l - 6, y: y + 4, 'text-anchor': 'end' });
        t.textContent = n(val);
        svg.appendChild(t);
      }
    }
  }

  /** Columns: one per item, { label, short, n, tip: [lines] }. */
  function drawColumns(el, items) {
    el.textContent = '';
    var W = Math.max(260, el.clientWidth), H = 190, pad = { t: 10, r: 4, b: 24, l: 34 };
    var svg = svgEl('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H });
    var max = niceMax(Math.max.apply(null, items.map(function (x) { return x.n; }).concat([1])));
    frame(svg, W, H, pad, max);
    var slot = (W - pad.l - pad.r) / items.length, bw = Math.min(24, Math.max(3, slot - 2));
    // as many labels as fit side by side, the rest left to the tooltip
    var longest = Math.max.apply(null, items.map(function (x) { return String(x.short || '').length; }).concat([2]));
    var every = Math.ceil(items.length / Math.max(1, Math.floor((W - pad.l - pad.r) / (longest * 6.4 + 10))));
    var lit = null, cur = -1, cols = [], hits = [];
    function off() { if (lit) lit.classList.remove('is-on'); lit = null; hideTip(); }
    function show(i, cx, cy) {
      off();
      cur = i;
      if (cols[i]) { cols[i].classList.add('is-on'); lit = cols[i]; }
      if (cx == null) { var b = hits[i].getBoundingClientRect(); cx = b.left + b.width / 2; cy = b.top + b.height / 3; }
      showTip(items[i].tip, cx, cy);
    }
    items.forEach(function (it, i) {
      var x = pad.l + i * slot + (slot - bw) / 2, base = H - pad.b;
      var h = (H - pad.t - pad.b) * (it.n / max), y = base - h, r = Math.min(4, bw / 2, h);
      cols[i] = null;
      if (h > 0) {
        // 4px rounded at the data end, square at the baseline
        cols[i] = svgEl('path', { d: 'M' + x + ',' + base + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + y + ' ' + (x + bw) + ',' + (y + r) + 'V' + base + 'Z', class: 'an-col' });
        svg.appendChild(cols[i]);
      }
      // the hit target is the whole slot, taller than the column
      hits[i] = svgEl('rect', { x: pad.l + i * slot, y: pad.t, width: slot, height: H - pad.t - pad.b, class: 'an-hit' });
      hits[i].addEventListener('pointermove', function (e) { show(i, e.clientX, e.clientY); });
      hits[i].addEventListener('pointerleave', off);
      svg.appendChild(hits[i]);
      if (i % every === 0 && it.short) {
        var t = svgEl('text', { x: pad.l + i * slot + slot / 2, y: H - 7, 'text-anchor': 'middle' });
        t.textContent = it.short;
        svg.appendChild(t);
      }
    });
    // one keyboard stop per chart: the arrow keys walk the columns
    svg.setAttribute('tabindex', '0');
    svg.setAttribute('class', 'an-cols-svg');
    svg.addEventListener('focus', function () { show(cur < 0 ? 0 : cur); });
    svg.addEventListener('blur', off);
    svg.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'Home' ? -1e9 : e.key === 'End' ? 1e9 : 0;
      if (!d) return;
      e.preventDefault();
      show(Math.max(0, Math.min(items.length - 1, (cur < 0 ? 0 : cur) + d)));
    });
    el.appendChild(svg);
  }

  /** A line over time with the area under it, a crosshair that finds the
      nearest point, and arrow keys that walk the points. rows: groupDays(). */
  function drawLine(el, rows) {
    el.textContent = '';
    var W = Math.max(260, el.clientWidth), H = 220, pad = { t: 12, r: 10, b: 26, l: 38 };
    var svg = svgEl('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, tabindex: '0', class: 'an-line-svg' });
    var max = niceMax(Math.max.apply(null, rows.map(function (r) { return r.v; }).concat([1])));
    frame(svg, W, H, pad, max);
    var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    var X = function (i) { return pad.l + (rows.length < 2 ? iw / 2 : iw * i / (rows.length - 1)); };
    var Y = function (v) { return pad.t + ih * (1 - v / max); };
    var line = rows.map(function (r, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(r.v).toFixed(1); }).join('');
    svg.appendChild(svgEl('path', { d: line + 'L' + X(rows.length - 1).toFixed(1) + ',' + (pad.t + ih) + 'L' + X(0).toFixed(1) + ',' + (pad.t + ih) + 'Z', class: 'an-area' }));
    svg.appendChild(svgEl('path', { d: line, class: 'an-line' }));
    var ticks = Math.min(rows.length, Math.max(2, Math.floor(iw / 90)));
    for (var k = 0; k < ticks; k++) {
      var i = Math.round(k * (rows.length - 1) / Math.max(1, ticks - 1));
      var t = svgEl('text', { x: X(i), y: H - 8, 'text-anchor': k === 0 ? 'start' : k === ticks - 1 ? 'end' : 'middle' });
      t.textContent = rows[i].by === 'month' ? MONTHS[+rows[i].d.slice(5, 7) - 1] + ' ' + rows[i].d.slice(0, 4) : dayShort(rows[i].d);
      svg.appendChild(t);
    }
    var cross = svgEl('line', { y1: pad.t, y2: pad.t + ih, class: 'an-cross', visibility: 'hidden' });
    var dot = svgEl('circle', { r: 4, class: 'an-dot', visibility: 'hidden' });
    svg.appendChild(cross);
    svg.appendChild(dot);
    var cur = -1;
    function at(i, cx, cy) {
      cur = i;
      var r = rows[i];
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(r.v)); dot.setAttribute('visibility', 'visible');
      var b = svg.getBoundingClientRect();
      var lines;
      if (r.by && r.by !== 'day') {
        lines = [dec(r.v) + ' επισκέψεις την ημέρα (μέσος όρος)', groupLabel(r),
          n(r.tv) + (r.tv === 1 ? ' επίσκεψη' : ' επισκέψεις') + ' και ' + n(r.tpv) + ' προβολές σελίδων συνολικά'];
      } else {
        lines = [n(r.v) + (r.v === 1 ? ' επίσκεψη' : ' επισκέψεις'), dayLong(r.d)];
        if (r.pv) lines.push(n(r.pv) + ' προβολές σελίδων');
      }
      showTip(lines, cx != null ? cx : b.left + X(i) * (b.width / W), cy != null ? cy : b.top + Y(r.v) * (b.height / H));
    }
    function off() { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); hideTip(); }
    svg.addEventListener('pointermove', function (e) {
      var b = svg.getBoundingClientRect(), x = (e.clientX - b.left) * (W / b.width);
      var i = rows.length < 2 ? 0 : Math.round((x - pad.l) / iw * (rows.length - 1));
      at(Math.max(0, Math.min(rows.length - 1, i)), e.clientX, e.clientY);
    });
    svg.addEventListener('pointerleave', off);
    svg.addEventListener('focus', function () { at(cur < 0 ? rows.length - 1 : cur); });
    svg.addEventListener('blur', off);
    svg.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'Home' ? -1e9 : e.key === 'End' ? 1e9 : 0;
      if (!d) return;
      e.preventDefault();
      at(Math.max(0, Math.min(rows.length - 1, (cur < 0 ? rows.length - 1 : cur) + d)));
    });
    el.appendChild(svg);
  }

  function drawAll() {
    drawn.forEach(function (c) {
      var el = document.getElementById(c.id);
      if (!el) return;
      if (c.kind === 'line') drawLine(el, c.payload); else drawColumns(el, c.payload);
    });
  }
  var lastW = 0, rt = null;
  window.addEventListener('resize', function () {
    if (Math.abs(window.innerWidth - lastW) < 20) return;
    clearTimeout(rt);
    rt = setTimeout(function () { lastW = window.innerWidth; hideTip(); drawAll(); }, 150);
  });

  /* ------------------------------------------------------- 1. the visits */
  function daysIn(w) {
    var out = [];
    if (!data || !data.days || !w || !w.from) return out;
    var d = new Date(w.from + 'T00:00:00Z'), end = new Date(w.to + 'T00:00:00Z');
    for (var guard = 0; d <= end && guard < 4000; guard++) {
      var key = d.toISOString().slice(0, 10), row = data.days[key] || [0, 0];
      out.push({ d: key, v: row[0] || 0, pv: row[1] || 0 });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }
  function srcNote(src, extra) {
    return 'Πηγή: ' + esc(SRC[src] || src) + (extra ? ' · ' + extra : '');
  }

  function trafficHTML() {
    var h = '<section class="an-part" aria-labelledby="an-visits-h"><h2 id="an-visits-h">Επισκεψιμότητα</h2>';
    var w = data && data.windows && data.windows[range];
    var any = data && data.windows && Object.keys(data.windows).length;
    if (!any) {
      return h + '<div class="notice"><strong>Οι μετρήσεις μόλις ξεκίνησαν</strong><p>Τα στοιχεία επισκεψιμότητας ενημερώνονται μία φορά την ημέρα. Θα εμφανιστούν εδώ μετά την πρώτη ενημέρωση.</p></div></section>';
    }
    h += '<div class="an-range" role="group" aria-label="Περίοδος">' + RANGES.map(function (r) {
      return '<button type="button" class="btn btn-sm ' + (r[0] === range ? 'btn-dark' : 'btn-outline') + '" data-range="' + r[0] + '" aria-pressed="' + (r[0] === range) + '">' + esc(r[1]) + '</button>';
    }).join('') + '</div>';
    if (!w) return h + '<p class="an-empty">Δεν υπάρχουν στοιχεία για αυτή την περίοδο.</p></section>';
    h += '<p class="an-period">' + esc(dayLong(w.from)) + ' – ' + esc(dayLong(w.to)) + (data.generated ? ' · ενημερώθηκε ' + esc(dayLong(String(data.generated).slice(0, 10))) : '') + '</p>';

    var visits = w.visits || 0, views = w.pageviews || 0;
    h += '<div class="an-kpis">' +
      kpi(n(visits), 'Επισκέψεις') + kpi(n(views), 'Προβολές σελίδων') +
      kpi(visits ? (views / visits).toLocaleString('el-GR', { maximumFractionDigits: 1 }) : '–', 'Σελίδες ανά επίσκεψη') +
      kpi(w.unis ? n(w.unis.items.length) : '–', 'Πανεπιστήμια και ερευνητικά κέντρα') + '</div>';

    h += '<div class="an-grid">';
    var rows = daysIn(w);
    if (rows.length > 1) {
      var grouped = groupDays(rows), by = grouped[0].by;
      var each = by === 'month' ? 'κάθε μήνα' : by === 'week' ? 'κάθε εβδομάδας' : '';
      h += card('Επισκέψεις ανά ημέρα', (each ? 'Ο μέσος όρος ' + each + '. ' : '') +
        'Κάθε επίσκεψη μετράει μία φορά, όσες σελίδες κι αν διαβάσει ο επισκέπτης.' + lineSource(w),
        chartSlot('line', grouped, each ? 'Επισκέψεις ανά ημέρα, μέσος όρος ' + each : 'Επισκέψεις ανά ημέρα') + daysTable(grouped), 'an-wide');
    }
    if (w.pages) h += card('Οι πιο δημοφιλείς σελίδες', srcNote(w.pages.src, 'προβολές σελίδων'),
      bars(w.pages.items.map(function (p) { return { label: p.title || p.path, n: p.n }; }), { caption: 'Οι πιο δημοφιλείς σελίδες', what: 'Σελίδα', unit: 'Προβολές', total: views }));
    if (w.hours) {
      var hours = w.hours.items;
      h += card('Ώρα της ημέρας', srcNote(w.hours.src, 'ώρα Ελλάδας, πότε ξεκινά κάθε επίσκεψη'), chartSlot('columns', hours.map(function (v, i) {
        var hh = (i < 10 ? '0' : '') + i;
        return { n: v, short: i % 3 === 0 ? hh : '', tip: [n(v) + (v === 1 ? ' επίσκεψη' : ' επισκέψεις'), hh + ':00–' + hh + ':59'] };
      }), 'Επισκέψεις ανά ώρα της ημέρας') + table(hours.map(function (v, i) { return [(i < 10 ? '0' : '') + i + ':00', v]; }), 'Ώρα', 'Επισκέψεις'));
    }
    var wd = weekdays(rows);
    if (rows.length >= 7) {
      h += card('Ημέρα της εβδομάδας', 'Μέσος όρος επισκέψεων ανά ημέρα της εβδομάδας', chartSlot('columns', wd.map(function (v, i) {
        return { n: v, short: WD_SHORT[i], tip: [v.toLocaleString('el-GR', { maximumFractionDigits: 1 }) + ' επισκέψεις κατά μέσο όρο', WEEKDAYS[i]] };
      }), 'Μέσος όρος επισκέψεων ανά ημέρα της εβδομάδας') + table(wd.map(function (v, i) { return [WEEKDAYS[i], v.toLocaleString('el-GR', { maximumFractionDigits: 1 })]; }), 'Ημέρα', 'Μέσος όρος'));
    }
    if (w.countries) h += card('Χώρες', srcNote(w.countries.src, 'επισκέψεις'),
      bars(w.countries.items.map(function (c) { return { label: countryLabel(c.k), n: c.n }; }), { caption: 'Χώρες', what: 'Χώρα', unit: 'Επισκέψεις' }));
    if (w.cities) h += card('Πόλεις', srcNote(w.cities.src, 'επισκέψεις'),
      bars(w.cities.items.map(function (c) { return { label: cityLabel(c.name) + (c.k && c.k !== 'GR' ? ' (' + countryLabel(c.k) + ')' : ''), n: c.n }; }), { caption: 'Πόλεις', what: 'Πόλη', unit: 'Επισκέψεις' }));
    if (w.unis) h += card('Πανεπιστήμια και ερευνητικά κέντρα', placedNote(w, 'unis'),
      bars(w.unis.items.map(function (u) { return { label: u.name, n: u.n }; }), { caption: 'Πανεπιστήμια και ερευνητικά κέντρα', what: 'Ίδρυμα', unit: 'Επισκέψεις', noPct: true, empty: 'Καμία επίσκεψη από πανεπιστημιακό δίκτυο σε αυτή την περίοδο.' }));
    if (w.companies) h += card('Εταιρείες και οργανισμοί', placedNote(w, 'companies'),
      bars(w.companies.items.map(function (u) { return { label: u.name, n: u.n }; }), { caption: 'Εταιρείες και οργανισμοί', what: 'Οργανισμός', unit: 'Επισκέψεις', noPct: true, empty: 'Καμία εταιρεία με δύο ή περισσότερες επισκέψεις σε αυτή την περίοδο.' }));
    if (w.channels) h += card('Πώς μας βρίσκουν', srcNote(w.channels.src, 'επισκέψεις'),
      bars(w.channels.items.map(function (c) { return { label: CHANNELS[c.k] || c.k, n: c.n }; }), { caption: 'Πώς μας βρίσκουν', what: 'Τρόπος', unit: 'Επισκέψεις' }));
    if (w.sources) h += card('Ιστότοποι που μας στέλνουν επισκέπτες', srcNote(w.sources.src, 'επισκέψεις'),
      bars(w.sources.items.map(function (c) { return { label: c.name, n: c.n }; }), { caption: 'Ιστότοποι που μας στέλνουν επισκέπτες', what: 'Ιστότοπος', unit: 'Επισκέψεις', empty: 'Κανένας ιστότοπος σε αυτή την περίοδο.' }));
    if (w.devices) h += card('Συσκευές', srcNote(w.devices.src, 'επισκέψεις'),
      bars(w.devices.items.map(function (c) { return { label: DEVICES[c.k] || c.k, n: c.n }; }), { caption: 'Συσκευές', what: 'Συσκευή', unit: 'Επισκέψεις' }));
    return h + '</div></section>';
  }
  function kpi(value, label) {
    return '<div class="an-kpi"><div class="value">' + value + '</div><div class="label">' + esc(label) + '</div></div>';
  }
  function placedNote(w, which) {
    var p = w.placed || {}, seen = p.seen || 0;
    var s = srcNote('site');
    if (!seen) return s;
    if (which === 'unis') {
      s += '. Από ' + n(seen) + ' επισκέψεις, ' + n(p.unis || 0) + ' (' + pct(p.unis || 0, seen) + ') έγιναν από δίκτυο πανεπιστημίου ή ερευνητικού κέντρου';
      if (p.academic) s += ' (από αυτές, ' + n(p.academic) + ' από δίκτυο που δεν κατονομάζει ίδρυμα)';
      return s + '.';
    }
    s += '. Από ' + n(seen) + ' επισκέψεις, ' + n(p.companies || 0) + ' (' + pct(p.companies || 0, seen) + ') έγιναν από δίκτυο εταιρείας ή οργανισμού. Εμφανίζονται όσοι έχουν τουλάχιστον δύο επισκέψεις';
    if (w.companies && w.companies.hidden) s += '· άλλοι ' + n(w.companies.hidden) + ' με μία επίσκεψη δεν κατονομάζονται';
    return s + '. Οι επισκέψεις από οικιακές και κινητές συνδέσεις δεν αντιστοιχίζονται σε κανέναν.';
  }
  function weekdays(rows) {
    var sum = [0, 0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0, 0];
    rows.forEach(function (r) {
      var wd = (new Date(r.d + 'T12:00:00Z').getUTCDay() + 6) % 7;      // Monday first
      sum[wd] += r.v; cnt[wd]++;
    });
    return sum.map(function (s, i) { return cnt[i] ? Math.round(s / cnt[i] * 10) / 10 : 0; });
  }
  function table(rows, a, b) {
    return '<details class="an-numbers"><summary>Τα νούμερα</summary><div class="an-scroll"><table class="data"><thead><tr><th scope="col">' + esc(a) + '</th><th scope="col">' + esc(b) + '</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(typeof r[1] === 'number' ? n(r[1]) : r[1]) + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
  }
  function daysTable(rows) {
    var by = rows.length ? rows[0].by : 'day';
    if (by === 'day') {
      return '<details class="an-numbers"><summary>Τα νούμερα ανά ημέρα</summary><div class="an-scroll"><table class="data"><thead><tr><th scope="col">Ημέρα</th><th scope="col">Επισκέψεις</th><th scope="col">Προβολές σελίδων</th></tr></thead><tbody>' +
        rows.slice().reverse().map(function (r) { return '<tr><td>' + esc(dayLong(r.d)) + '</td><td>' + n(r.v) + '</td><td>' + n(r.pv) + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
    }
    var what = by === 'month' ? 'Μήνας' : 'Εβδομάδα';
    return '<details class="an-numbers"><summary>Τα νούμερα ανά ' + (by === 'month' ? 'μήνα' : 'εβδομάδα') + '</summary><div class="an-scroll"><table class="data"><thead><tr><th scope="col">' + what + '</th><th scope="col">Επισκέψεις</th><th scope="col">Προβολές σελίδων</th><th scope="col">Επισκέψεις ανά ημέρα</th></tr></thead><tbody>' +
      rows.slice().reverse().map(function (r) { return '<tr><td>' + esc(by === 'week' ? spanLabel(r.d, r.last) : groupLabel(r)) + '</td><td>' + n(r.tv) + '</td><td>' + n(r.tpv) + '</td><td>' + dec(r.v) + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
  }
  /** Which counter the line comes from, and where it changes over. */
  function lineSource(w) {
    var src = (data && data.sources) || {}, first = src.site && src.site.first;
    if (src.ga4 && first && w.from < first && first <= w.to) {
      return ' Έως ' + esc(dayLong(addDay(first, -1))) + ' από το Google Analytics, από ' + esc(dayLong(first)) + ' από τον μετρητή του ιστότοπου.';
    }
    if (first && w.from >= first) return ' ' + srcNote('site') + '.';
    if (src.ga4) return ' ' + srcNote('ga4') + '.';
    return '';
  }

  /* ------------------------------------------------------ 2. the members */
  function label(dim, it) {
    if (it.k === '_other') return OTHER;
    switch (dim) {
      case 'stage': return STAGES[it.k] || it.k;
      case 'gender': return GENDERS[it.k] || it.k;
      case 'industry': return (PO && PO.industryLabel(it.k)) || it.k;
      case 'country': return countryLabel(it.k);
      case 'study': return it.k === '05' ? 'Έως 5 έτη' : it.k === '10' ? '10 έτη ή περισσότερα' : (+it.k) + ' έτη';
      default: return it.name || it.k;
    }
  }
  function memberDim(dim, title, sub) {
    var d = members.dims && members.dims[dim];
    if (!d) return '';
    var answered = d.answered || 0;
    var note = (sub ? sub + ' · ' : '') + 'Απάντησαν ' + n(answered) + ' από ' + n(members.registered);
    if (!d.items) return card(title, note, '<p class="an-empty">Δεν υπάρχουν ακόμα αρκετές απαντήσεις (χρειάζονται τουλάχιστον ' + n(members.minAnswers || 5) + ').</p>');
    return card(title, note, bars(d.items.map(function (it) { return { label: label(dim, it), n: it.n, other: it.k === '_other' }; }), { caption: title, total: answered, unit: 'Μέλη' }));
  }
  function memberColumns(dim, title, sub) {
    var d = members.dims && members.dims[dim];
    if (!d) return '';
    var note = (sub ? sub + ' · ' : '') + 'Απάντησαν ' + n(d.answered || 0) + ' από ' + n(members.registered);
    if (!d.items) return card(title, note, '<p class="an-empty">Δεν υπάρχουν ακόμα αρκετές απαντήσεις (χρειάζονται τουλάχιστον ' + n(members.minAnswers || 5) + ').</p>');
    var items = d.items.map(function (it) {
      var l = label(dim, it);
      return { n: it.n, short: it.k === '_other' ? 'Λοιπά' : dim === 'study' ? (it.k === '05' ? '≤5' : it.k === '10' ? '10+' : String(+it.k)) : String(it.k).replace(/^(\d{4})–\d\d(\d\d)$/, '$1–$2'), tip: [n(it.n) + ' μέλη', l] };
    });
    return card(title, note, chartSlot('columns', items, title) +
      table(d.items.map(function (it) { return [label(dim, it), it.n]; }), dim === 'study' ? 'Χρόνια σπουδών' : 'Περίοδος', 'Μέλη'));
  }
  function membersHTML() {
    var h = '<section class="an-part" id="meli" aria-labelledby="an-members-h"><h2 id="an-members-h">Τα μέλη μας</h2>' +
      '<p class="an-lead">Ανώνυμα στατιστικά όσων έχουν εγγραφεί στον ιστότοπο, ενημερωμένα κάθε φορά που κάποιος εγγράφεται ή αλλάζει τα στοιχεία του. ' +
      'Μετράμε μόνο σύνολα ανά ερώτηση· ομάδες με λιγότερα από 3 άτομα συγχωνεύονται στα «Λοιπά» και κάθε ερώτηση εμφανίζεται μόνο όταν την έχουν απαντήσει τουλάχιστον 5 άτομα. ' +
      'Δεν δημοσιεύεται κανένα όνομα, e-mail ή στοιχείο ενός συγκεκριμένου ατόμου.</p>';
    if (membersState === 'loading') return h + '<div class="loading"><span class="spinner" aria-hidden="true"></span>Φόρτωση…</div></section>';
    if (membersState !== 'ok') return h + '<div class="notice"><strong>Τα στατιστικά των μελών θα εμφανιστούν σύντομα</strong><p>Μετρώνται αυτόματα από τις εγγραφές στον ιστότοπο.</p></div></section>';
    var m = members;
    h += '<p class="an-period">Τρέχουσα εικόνα' + (m.t ? ' · ενημερώθηκε ' + esc(dayLong(String(m.t).slice(0, 10))) : '') + '</p>';
    h += '<div class="an-kpis">' + kpi(n(m.registered), 'Εγγεγραμμένοι') + kpi(n(m.active), 'Ενεργά μέλη') +
      kpi(m.dims && m.dims.country && m.dims.country.items ? n(m.dims.country.items.filter(function (x) { return x.k !== '_other'; }).length) : '–', 'Χώρες με τουλάχιστον 3 μέλη') +
      kpi(m.dims && m.dims.employer && m.dims.employer.items ? n(m.dims.employer.items.filter(function (x) { return x.k !== '_other'; }).length) : '–', 'Εργοδότες με τουλάχιστον 3 μέλη') + '</div>';
    h += '<div class="an-grid">' +
      memberDim('stage', 'Ιδιότητα') +
      memberDim('direction', 'Κατεύθυνση σπουδών') +
      memberColumns('entry', 'Έτος εισαγωγής στη ΣΕΜΦΕ', 'ανά πενταετία') +
      memberColumns('grad', 'Έτος αποφοίτησης', 'ανά πενταετία') +
      memberColumns('study', 'Χρόνια σπουδών στη ΣΕΜΦΕ', 'από την εισαγωγή ως την αποφοίτηση') +
      memberDim('gender', 'Φύλο', 'προαιρετική ερώτηση') +
      memberDim('industry', 'Κλάδος εργασίας') +
      memberDim('employer', 'Εργοδότες', 'όσοι έχουν τουλάχιστον 3 μέλη μας') +
      memberDim('country', 'Χώρα') +
      memberDim('city', 'Πόλη');
    if (m.growth && m.growth.length) {
      var total = 0;
      var items = m.growth.map(function (g) {
        total += g[1];
        return { n: g[1], short: MONTHS[+g[0].slice(5, 7) - 1] + (g[0].slice(5, 7) === '01' || g === m.growth[0] ? ' ' + g[0].slice(2, 4) : ''), tip: [n(g[1]) + (g[1] === 1 ? ' νέα εγγραφή' : ' νέες εγγραφές'), monthName(g[0]), 'σύνολο ως τότε: ' + n(total)] };
      });
      h += card('Εγγραφές ανά μήνα', 'Νέες εγγραφές στον ιστότοπο κάθε μήνα', chartSlot('columns', items, 'Εγγραφές ανά μήνα') +
        table(m.growth.map(function (g) { return [monthName(g[0]), g[1]]; }), 'Μήνας', 'Νέες εγγραφές'), 'an-wide');
    }
    return h + '</div></section>';
  }

  /* ---------------------------------------------------------- the page */
  function render() {
    hideTip();
    var keep = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-range');
    drawn = [];
    chartId = 0;
    app.innerHTML = '<div class="an">' + (data ? trafficHTML() : '<div class="loading"><span class="spinner" aria-hidden="true"></span>Φόρτωση…</div>') + membersHTML() + '</div>';
    drawAll();
    if (keep) { var b = app.querySelector('[data-range="' + keep + '"]'); if (b) b.focus(); }
  }
  app.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-range]');
    if (!b) return;
    range = b.getAttribute('data-range');
    try { sessionStorage.setItem('semfeAnRange', range); } catch (x) { /* fine */ }
    render();
  });

  fetch(root + 'data/analytics.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (j) { data = j && typeof j === 'object' ? j : {}; }, function () { data = {}; })
    .then(render);

  var F = C.FIREBASE || {};
  var configured = !!(F.apiKey && F.projectId && String(F.apiKey + F.projectId).indexOf('PASTE_') === -1);
  if (configured && window.fetch) {
    fetch('https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(F.projectId) +
      '/databases/(default)/documents/publicStats/members?key=' + encodeURIComponent(F.apiKey), { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var raw = j && j.fields && j.fields.json && j.fields.json.stringValue;
        var m = raw ? JSON.parse(raw) : null;
        if (m && typeof m.registered === 'number' && m.dims) { members = m; membersState = 'ok'; }
        else membersState = 'none';
      }, function () { membersState = 'none'; })
      .then(render);
  } else {
    membersState = 'none';
  }
  render();
}());
