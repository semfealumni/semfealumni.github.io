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
  var L = window.SEMFE_I18N, T = L.t;
  var root = (A && A.root) || '../';
  var NF = new Intl.NumberFormat(L.locale);
  var PF = new Intl.NumberFormat(L.locale, { style: 'percent', maximumFractionDigits: 0 });
  var MONTHS = L.en
    ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    : ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μαΐ', 'Ιουν', 'Ιουλ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ'];
  var MONTHS_LONG = L.en
    ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    : ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου', 'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'];
  var MONTH_NAMES = L.en
    ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    : ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος', 'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'];
  var WEEKDAYS = L.en
    ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    : ['Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο', 'Κυριακή'];
  var WD_SHORT = L.en
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['Δευ', 'Τρί', 'Τετ', 'Πέμ', 'Παρ', 'Σάβ', 'Κυρ'];
  var RANGES = [['30', T('30 ημέρες', '30 days')], ['90', T('90 ημέρες', '90 days')], ['365', T('12 μήνες', '12 months')], ['all', T('Από την αρχή', 'Since the start')]];
  var CHANNELS = { direct: T('Απευθείας', 'Direct'), search: T('Μηχανές αναζήτησης', 'Search engines'), social: T('Κοινωνικά δίκτυα', 'Social networks'), email: 'E-mail', other: T('Άλλοι ιστότοποι', 'Other websites') };
  var DEVICES = { desktop: T('Υπολογιστής', 'Computer'), mobile: T('Κινητό', 'Mobile phone'), tablet: 'Tablet' };
  var STAGES = { graduate: T('Απόφοιτοι', 'Graduates'), 'final-year': T('Τελειόφοιτοι', 'Final-year students'), faculty: T('Μέλη ΔΕΠ', 'Faculty members') };
  var GENDERS = { female: T('Γυναίκες', 'Women'), male: T('Άνδρες', 'Men'), other: T('Άλλο', 'Other') };
  var OTHER = T('Λοιπά (ομάδες κάτω από 3 ατόμων)', 'Other (groups of fewer than 3 people)');
  var SRC = { site: T('ο μετρητής του ιστότοπου', 'the website\'s own visit counter'), ga4: 'Google Analytics' };
  /* the stored field of study (account.js offers these three) as an English page names it */
  var DIRECTION_EN = { 'Εφαρμοσμένα Μαθηματικά': 'Applied Mathematics', 'Εφαρμοσμένη Φυσική': 'Applied Physics', 'Άλλη / δεν ισχύει': 'Other / not applicable' };
  var GREEK = /[\u0370-\u03ff\u1f00-\u1fff]/;
  /* the Greek institutions functions/netorg.js names in Greek (the counters keep
     the name as written), by their official English names for the English page;
     any other name (foreign universities, companies) is shown as it is */
  var UNI_EN = {
    'Εθνικό Μετσόβιο Πολυτεχνείο': 'National Technical University of Athens',
    'Εθνικό και Καποδιστριακό Πανεπιστήμιο Αθηνών': 'National and Kapodistrian University of Athens',
    'Αριστοτέλειο Πανεπιστήμιο Θεσσαλονίκης': 'Aristotle University of Thessaloniki',
    'Πανεπιστήμιο Πατρών': 'University of Patras',
    'Πανεπιστήμιο Κρήτης': 'University of Crete',
    'Πολυτεχνείο Κρήτης': 'Technical University of Crete',
    'Πανεπιστήμιο Ιωαννίνων': 'University of Ioannina',
    'Δημοκρίτειο Πανεπιστήμιο Θράκης': 'Democritus University of Thrace',
    'Πανεπιστήμιο Θεσσαλίας': 'University of Thessaly',
    'Οικονομικό Πανεπιστήμιο Αθηνών': 'Athens University of Economics and Business',
    'Πανεπιστήμιο Πειραιώς': 'University of Piraeus',
    'Πανεπιστήμιο Μακεδονίας': 'University of Macedonia',
    'Πανεπιστήμιο Αιγαίου': 'University of the Aegean',
    'Ιόνιο Πανεπιστήμιο': 'Ionian University',
    'Χαροκόπειο Πανεπιστήμιο': 'Harokopio University',
    'Πάντειο Πανεπιστήμιο': 'Panteion University',
    'Ελληνικό Ανοικτό Πανεπιστήμιο': 'Hellenic Open University',
    'Διεθνές Πανεπιστήμιο της Ελλάδος': 'International Hellenic University',
    'Πανεπιστήμιο Δυτικής Αττικής': 'University of West Attica',
    'Πανεπιστήμιο Πελοποννήσου': 'University of the Peloponnese',
    'Πανεπιστήμιο Δυτικής Μακεδονίας': 'University of Western Macedonia',
    'Ελληνικό Μεσογειακό Πανεπιστήμιο': 'Hellenic Mediterranean University',
    'Γεωπονικό Πανεπιστήμιο Αθηνών': 'Agricultural University of Athens',
    'Ανωτάτη Σχολή Καλών Τεχνών': 'Athens School of Fine Arts',
    'Σχολή Ναυτικών Δοκίμων': 'Hellenic Naval Academy',
    'Στρατιωτική Σχολή Ευελπίδων': 'Hellenic Army Academy',
    'Σχολή Ικάρων': 'Hellenic Air Force Academy',
    'ΕΚΕΦΕ «Δημόκριτος»': 'National Centre for Scientific Research “Demokritos”',
    'Ίδρυμα Τεχνολογίας και Έρευνας (ΙΤΕ)': 'Foundation for Research and Technology Hellas (FORTH)',
    'Εθνικό Κέντρο Έρευνας και Τεχνολογικής Ανάπτυξης (ΕΚΕΤΑ)': 'Centre for Research and Technology Hellas (CERTH)',
    'Ερευνητικό Κέντρο «Αθηνά»': 'Athena Research Center',
    'Εθνικό Ίδρυμα Ερευνών': 'National Hellenic Research Foundation',
    'Εθνικό Αστεροσκοπείο Αθηνών': 'National Observatory of Athens',
    'Ακαδημία Αθηνών': 'Academy of Athens',
    'Ίδρυμα Ιατροβιολογικών Ερευνών Ακαδημίας Αθηνών': 'Biomedical Research Foundation of the Academy of Athens',
    'Ερευνητικό Κέντρο «Αλέξανδρος Φλέμινγκ»': 'Biomedical Sciences Research Center “Alexander Fleming”',
    'Ελληνικό Κέντρο Θαλάσσιων Ερευνών': 'Hellenic Centre for Marine Research',
    'Πανεπιστήμιο Κύπρου': 'University of Cyprus',
    'Τεχνολογικό Πανεπιστήμιο Κύπρου': 'Cyprus University of Technology'
  };
  function uniName(name) { return L.en && Object.prototype.hasOwnProperty.call(UNI_EN, name) ? UNI_EN[name] : name; }

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
  function dec(x) { return (x || 0).toLocaleString(L.locale, { maximumFractionDigits: 1 }); }
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
    if (rows.length <= 120) return rows.map(function (r) { return { by: 'day', d: r.d, last: r.d, days: r.v == null ? 0 : 1, v: r.v, pv: r.pv, tv: r.v, tpv: r.pv }; });
    var by = rows.length <= 730 ? 'week' : 'month', out = [], cur = null;
    rows.forEach(function (r) {
      var k = by === 'month' ? r.d.slice(0, 7) : weekStart(r.d);
      if (!cur || cur.k !== k) { cur = { k: k, by: by, d: r.d, last: r.d, days: 0, tv: 0, tpv: 0 }; out.push(cur); }
      cur.last = r.d;
      if (r.v == null) return;                       // not measured: neither 0 nor counted
      cur.days++; cur.tv += r.v; cur.tpv += r.pv;
    });
    out.forEach(function (g) {
      g.v = g.days ? Math.round(g.tv / g.days * 10) / 10 : null;
      g.pv = g.days ? Math.round(g.tpv / g.days * 10) / 10 : null;
    });
    return out;
  }
  function groupLabel(g) {
    if (g.by === 'month') {
      var full = g.d.slice(8) === '01' && addDay(g.last, 1).slice(8) === '01';
      return monthName(g.d.slice(0, 7)) + (full ? '' : ' (' + spanLabel(g.d, g.last) + ')');
    }
    return g.by === 'week' ? T('Εβδομάδα ', 'Week ') + spanLabel(g.d, g.last) : dayLong(g.d);
  }
  var regionNames = null;
  try { regionNames = new Intl.DisplayNames([L.lang], { type: 'region' }); } catch (e) { regionNames = null; }
  function countryLabel(code) {
    if (!code || code === '??' || code === '(not set)') return T('Άγνωστη χώρα', 'Unknown country');
    if (code === 'XX') return T('Άλλη χώρα', 'Another country');
    var p = PO && PO.countryName(code, L.lang);
    // (an English page never shows a Greek country name: the browser's own English name instead)
    if (p && !(L.en && GREEK.test(p))) return p;
    try { return (regionNames && regionNames.of(code)) || code; } catch (e) { return code; }
  }
  function cityLabel(name) {
    var c = PO ? PO.cityName(name, L.lang) || name : name;
    // (an English page never turns a city written in Latin letters into its Greek name)
    return L.en && GREEK.test(c) && !GREEK.test(name) ? name : c;
  }
  function card(title, sub, body, cls) {
    return '<article class="an-card' + (cls ? ' ' + cls : '') + '"><h3>' + esc(title) + '</h3>' + (sub ? '<p class="an-sub">' + sub + '</p>' : '') + body + '</article>';
  }

  /** A list of categories as a table that is also a bar chart: name, bar,
      number, share. Rows: [{ label, n, other }] (already sorted). */
  function bars(rows, opts) {
    opts = opts || {};
    if (!rows || !rows.length) return '<p class="an-empty">' + esc(opts.empty || T('Δεν υπάρχουν ακόμα στοιχεία για αυτή την περίοδο.', 'There are no figures for this period yet.')) + '</p>';
    var max = 0, total = opts.total || 0;
    rows.forEach(function (r) { if (r.n > max) max = r.n; if (!opts.total) total += r.n; });
    return '<div class="an-scroll"><table class="an-bars"><caption class="sr-only">' + esc(opts.caption || '') + '</caption>' +
      '<thead class="sr-only"><tr><th scope="col">' + esc(opts.what || T('Κατηγορία', 'Category')) + '</th><th scope="col">' + esc(opts.unit || T('Αριθμός', 'Number')) + '</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var w = max ? Math.max(1.5, Math.round(r.n / max * 1000) / 10) : 0;
        // a name from the data is shown as it is: on the English page, a Greek one is marked as Greek
        return '<tr' + (r.other ? ' class="an-other"' : '') + '><th scope="row"' + (L.en && GREEK.test(r.label) ? ' lang="el"' : '') + '>' + esc(r.label) + '</th>' +
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
    var max = niceMax(Math.max.apply(null, rows.map(function (r) { return r.v || 0; }).concat([1])));
    frame(svg, W, H, pad, max);
    var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    var X = function (i) { return pad.l + (rows.length < 2 ? iw / 2 : iw * i / (rows.length - 1)); };
    var Y = function (v) { return pad.t + ih * (1 - v / max); };
    // one stretch of line per run of measured points: an unmeasured stretch is a break, never a drop to 0
    var runs = [], run = null;
    rows.forEach(function (r, i) {
      if (r.v == null) { run = null; return; }
      if (!run) { run = []; runs.push(run); }
      run.push(i);
    });
    var line = '';
    runs.forEach(function (idx) {
      var seg = idx.map(function (i, k) { return (k ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(rows[i].v).toFixed(1); }).join('');
      if (idx.length === 1) seg += 'h0.01';            // a lone point still shows (round line caps)
      line += seg;
      svg.appendChild(svgEl('path', { d: seg + 'L' + X(idx[idx.length - 1]).toFixed(1) + ',' + (pad.t + ih) + 'L' + X(idx[0]).toFixed(1) + ',' + (pad.t + ih) + 'Z', class: 'an-area' }));
    });
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
      dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(r.v || 0)); dot.setAttribute('visibility', r.v == null ? 'hidden' : 'visible');
      var b = svg.getBoundingClientRect();
      var lines;
      if (r.v == null) {
        lines = [T('Χωρίς μετρήσεις', 'Not measured'), r.by && r.by !== 'day' ? groupLabel(r) : dayLong(r.d)];
      } else if (r.by && r.by !== 'day') {
        lines = [dec(r.v) + T(' επισκέψεις την ημέρα (μέσος όρος)', r.v === 1 ? ' visit a day (average)' : ' visits a day (average)'), groupLabel(r),
          T(n(r.tv) + (r.tv === 1 ? ' επίσκεψη' : ' επισκέψεις') + ' και ' + n(r.tpv) + ' προβολές σελίδων συνολικά',
            n(r.tv) + (r.tv === 1 ? ' visit' : ' visits') + ' and ' + n(r.tpv) + (r.tpv === 1 ? ' page view' : ' page views') + ' in total')];
      } else {
        lines = [n(r.v) + (r.v === 1 ? T(' επίσκεψη', ' visit') : T(' επισκέψεις', ' visits')), dayLong(r.d)];
        if (r.pv) lines.push(n(r.pv) + T(' προβολές σελίδων', r.pv === 1 ? ' page view' : ' page views'));
      }
      showTip(lines, cx != null ? cx : b.left + X(i) * (b.width / W), cy != null ? cy : b.top + Y(r.v || 0) * (b.height / H));
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
    var d = new Date(w.from + 'T00:00:00Z'), end = new Date(w.to + 'T00:00:00Z'), holes = data.gaps || [];
    for (var guard = 0; d <= end && guard < 4000; guard++) {
      var key = d.toISOString().slice(0, 10), row = data.days[key] || [0, 0];
      // a day inside a stretch nothing was measured is unknown (null), not 0
      var off = holes.some(function (g) { return key >= g[0] && key <= g[1]; });
      out.push(off ? { d: key, v: null, pv: null } : { d: key, v: row[0] || 0, pv: row[1] || 0 });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }
  function srcNote(src, extra) {
    return T('Πηγή: ', 'Source: ') + esc(SRC[src] || src) + (extra ? ' · ' + extra : '');
  }

  function trafficHTML() {
    var h = '<section class="an-part" aria-labelledby="an-visits-h"><h2 id="an-visits-h">' + T('Επισκεψιμότητα', 'Visits') + '</h2>';
    var w = data && data.windows && data.windows[range];
    var any = data && data.windows && Object.keys(data.windows).length;
    if (!any) {
      return h + '<div class="notice"><strong>' + T('Οι μετρήσεις μόλις ξεκίνησαν', 'Measuring has just started') + '</strong><p>' +
        T('Τα στοιχεία επισκεψιμότητας ενημερώνονται μία φορά την ημέρα. Θα εμφανιστούν εδώ μετά την πρώτη ενημέρωση.', 'The visit figures are updated once a day. They will appear here after the first update.') + '</p></div></section>';
    }
    h += '<div class="an-range" role="group" aria-label="' + T('Περίοδος', 'Period') + '">' + RANGES.map(function (r) {
      return '<button type="button" class="btn btn-sm ' + (r[0] === range ? 'btn-dark' : 'btn-outline') + '" data-range="' + r[0] + '" aria-pressed="' + (r[0] === range) + '">' + esc(r[1]) + '</button>';
    }).join('') + '</div>';
    if (!w) {
      var other = RANGES.filter(function (r) { return data.windows[r[0]]; }).map(function (r) { return T('«', '“') + esc(r[1]) + T('»', '”'); });
      return h + '<p class="an-empty">' + T('Δεν υπάρχουν μετρήσεις για αυτή την περίοδο' + (other.length ? '. Δείτε ' + other.join(', ') + '.' : '.'),
        'There are no figures for this period' + (other.length ? '. See ' + L.orList(other) + '.' : '.')) + '</p></section>';
    }
    h += '<p class="an-period">' + esc(dayLong(w.from)) + ' – ' + esc(dayLong(w.to)) + (data.generated ? T(' · ενημερώθηκε ', ' · updated ') + esc(dayLong(String(data.generated).slice(0, 10))) : '') + '</p>';

    var visits = w.visits || 0, views = w.pageviews || 0;
    h += '<div class="an-kpis">' +
      kpi(n(visits), T('Επισκέψεις', 'Visits')) + kpi(n(views), T('Προβολές σελίδων', 'Page views')) +
      kpi(visits ? (views / visits).toLocaleString(L.locale, { maximumFractionDigits: 1 }) : '–', T('Σελίδες ανά επίσκεψη', 'Pages per visit')) +
      kpi(w.unis ? n(w.unis.items.length) : '–', T('Πανεπιστήμια και ερευνητικά κέντρα', 'Universities and research centres')) + '</div>';

    h += '<div class="an-grid">';
    var rows = daysIn(w);
    if (rows.length > 1) {
      var grouped = groupDays(rows), by = grouped[0].by;
      var each = by === 'month' ? T('κάθε μήνα', 'each month') : by === 'week' ? T('κάθε εβδομάδας', 'each week') : '';
      h += card(T('Επισκέψεις ανά ημέρα', 'Visits per day'), (each ? T('Ο μέσος όρος ' + each + '. ', 'The average for ' + each + '. ') : '') +
        T('Κάθε επίσκεψη μετράει μία φορά, όσες σελίδες κι αν διαβάσει ο επισκέπτης.', 'Each visit counts once, however many pages the visitor reads.') + lineSource(w) + gapNote(w),
        chartSlot('line', grouped, each ? T('Επισκέψεις ανά ημέρα, μέσος όρος ' + each, 'Visits per day, average for ' + each) : T('Επισκέψεις ανά ημέρα', 'Visits per day')) + daysTable(grouped), 'an-wide');
    }
    if (w.pages) h += card(T('Οι πιο δημοφιλείς σελίδες', 'The most popular pages'), srcNote(w.pages.src, T('προβολές σελίδων', 'page views')),
      bars(w.pages.items.map(function (p) { return { label: (L.en && p.titleEn ? p.titleEn : p.title) || p.path, n: p.n }; }), { caption: T('Οι πιο δημοφιλείς σελίδες', 'The most popular pages'), what: T('Σελίδα', 'Page'), unit: T('Προβολές', 'Views'), total: views }));
    if (w.hours) {
      var hours = w.hours.items;
      h += card(T('Ώρα της ημέρας', 'Time of day'), srcNote(w.hours.src, T('ώρα Ελλάδας, πότε ξεκινά κάθε επίσκεψη', 'Greek time, when each visit starts')), chartSlot('columns', hours.map(function (v, i) {
        var hh = (i < 10 ? '0' : '') + i;
        return { n: v, short: i % 3 === 0 ? hh : '', tip: [n(v) + (v === 1 ? T(' επίσκεψη', ' visit') : T(' επισκέψεις', ' visits')), hh + ':00–' + hh + ':59'] };
      }), T('Επισκέψεις ανά ώρα της ημέρας', 'Visits by hour of the day')) + table(hours.map(function (v, i) { return [(i < 10 ? '0' : '') + i + ':00', v]; }), T('Ώρα', 'Hour'), T('Επισκέψεις', 'Visits')));
    }
    var wd = weekdays(rows);
    if (rows.length >= 7) {
      h += card(T('Ημέρα της εβδομάδας', 'Day of the week'), T('Μέσος όρος επισκέψεων ανά ημέρα της εβδομάδας', 'Average visits on each day of the week'), chartSlot('columns', wd.map(function (v, i) {
        return { n: v, short: WD_SHORT[i], tip: [v.toLocaleString(L.locale, { maximumFractionDigits: 1 }) + T(' επισκέψεις κατά μέσο όρο', v === 1 ? ' visit on average' : ' visits on average'), WEEKDAYS[i]] };
      }), T('Μέσος όρος επισκέψεων ανά ημέρα της εβδομάδας', 'Average visits on each day of the week')) + table(wd.map(function (v, i) { return [WEEKDAYS[i], v.toLocaleString(L.locale, { maximumFractionDigits: 1 })]; }), T('Ημέρα', 'Day'), T('Μέσος όρος', 'Average')));
    }
    var VISITS = T('επισκέψεις', 'visits'), UNIT = T('Επισκέψεις', 'Visits');
    if (w.countries) h += card(T('Χώρες', 'Countries'), srcNote(w.countries.src, VISITS),
      bars(w.countries.items.map(function (c) { return { label: countryLabel(c.k), n: c.n }; }), { caption: T('Χώρες', 'Countries'), what: T('Χώρα', 'Country'), unit: UNIT }));
    if (w.cities) h += card(T('Πόλεις', 'Cities'), srcNote(w.cities.src, VISITS),
      bars(w.cities.items.map(function (c) { return { label: cityLabel(c.name) + (c.k && c.k !== 'GR' ? ' (' + countryLabel(c.k) + ')' : ''), n: c.n }; }), { caption: T('Πόλεις', 'Cities'), what: T('Πόλη', 'City'), unit: UNIT }));
    if (w.unis) h += card(T('Πανεπιστήμια και ερευνητικά κέντρα', 'Universities and research centres'), placedNote(w, 'unis'),
      bars(w.unis.items.map(function (u) { return { label: uniName(u.name), n: u.n }; }), { caption: T('Πανεπιστήμια και ερευνητικά κέντρα', 'Universities and research centres'), what: T('Ίδρυμα', 'Institution'), unit: UNIT, noPct: true, empty: T('Καμία επίσκεψη από πανεπιστημιακό δίκτυο σε αυτή την περίοδο.', 'No visits from a university network in this period.') }));
    if (w.companies) h += card(T('Εταιρείες και οργανισμοί', 'Companies and organisations'), placedNote(w, 'companies'),
      bars(w.companies.items.map(function (u) { return { label: u.name, n: u.n }; }), { caption: T('Εταιρείες και οργανισμοί', 'Companies and organisations'), what: T('Οργανισμός', 'Organisation'), unit: UNIT, noPct: true, empty: T('Καμία εταιρεία με δύο ή περισσότερες επισκέψεις σε αυτή την περίοδο.', 'No company with two or more visits in this period.') }));
    if (w.channels) h += card(T('Πώς μας βρίσκουν', 'How people find us'), srcNote(w.channels.src, VISITS),
      bars(w.channels.items.map(function (c) { return { label: CHANNELS[c.k] || c.k, n: c.n }; }), { caption: T('Πώς μας βρίσκουν', 'How people find us'), what: T('Τρόπος', 'Channel'), unit: UNIT }));
    if (w.sources) h += card(T('Ιστότοποι που μας στέλνουν επισκέπτες', 'Websites that send us visitors'), srcNote(w.sources.src, VISITS),
      bars(w.sources.items.map(function (c) { return { label: c.name, n: c.n }; }), { caption: T('Ιστότοποι που μας στέλνουν επισκέπτες', 'Websites that send us visitors'), what: T('Ιστότοπος', 'Website'), unit: UNIT, empty: T('Κανένας ιστότοπος σε αυτή την περίοδο.', 'No websites in this period.') }));
    if (w.devices) h += card(T('Συσκευές', 'Devices'), srcNote(w.devices.src, VISITS),
      bars(w.devices.items.map(function (c) { return { label: DEVICES[c.k] || c.k, n: c.n }; }), { caption: T('Συσκευές', 'Devices'), what: T('Συσκευή', 'Device'), unit: UNIT }));
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
      s += T('. Από ' + n(seen) + ' επισκέψεις, ' + n(p.unis || 0) + ' (' + pct(p.unis || 0, seen) + ') έγιναν από δίκτυο πανεπιστημίου ή ερευνητικού κέντρου',
        '. Of ' + n(seen) + (seen === 1 ? ' visit, ' : ' visits, ') + n(p.unis || 0) + ' (' + pct(p.unis || 0, seen) + ') came from a university or research centre network');
      if (p.academic) s += T(' (από αυτές, ' + n(p.academic) + ' από δίκτυο που δεν κατονομάζει ίδρυμα)', ' (of these, ' + n(p.academic) + ' from a network that does not name an institution)');
      return s + '.';
    }
    s += T('. Από ' + n(seen) + ' επισκέψεις, ' + n(p.companies || 0) + ' (' + pct(p.companies || 0, seen) + ') έγιναν από δίκτυο εταιρείας ή οργανισμού. Εμφανίζονται όσοι έχουν τουλάχιστον δύο επισκέψεις',
      '. Of ' + n(seen) + (seen === 1 ? ' visit, ' : ' visits, ') + n(p.companies || 0) + ' (' + pct(p.companies || 0, seen) + ') came from a company or organisation network. Those with at least two visits are shown');
    if (w.companies && w.companies.hidden) s += T('· άλλοι ' + n(w.companies.hidden) + ' με μία επίσκεψη δεν κατονομάζονται',
      w.companies.hidden === 1 ? '; one more, with a single visit, is not named' : '; another ' + n(w.companies.hidden) + ' with a single visit each are not named');
    return s + T('. Οι επισκέψεις από οικιακές και κινητές συνδέσεις δεν αντιστοιχίζονται σε κανέναν.', '. Visits from home and mobile connections are not matched to anyone.');
  }
  function weekdays(rows) {
    var sum = [0, 0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0, 0];
    rows.forEach(function (r) {
      if (r.v == null) return;                                           // not measured
      var wd = (new Date(r.d + 'T12:00:00Z').getUTCDay() + 6) % 7;      // Monday first
      sum[wd] += r.v; cnt[wd]++;
    });
    return sum.map(function (s, i) { return cnt[i] ? Math.round(s / cnt[i] * 10) / 10 : 0; });
  }
  function table(rows, a, b) {
    return '<details class="an-numbers"><summary>' + T('Τα νούμερα', 'The numbers') + '</summary><div class="an-scroll"><table class="data"><thead><tr><th scope="col">' + esc(a) + '</th><th scope="col">' + esc(b) + '</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(typeof r[1] === 'number' ? n(r[1]) : r[1]) + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
  }
  function daysTable(rows) {
    var by = rows.length ? rows[0].by : 'day';
    if (by === 'day') {
      return '<details class="an-numbers"><summary>' + T('Τα νούμερα ανά ημέρα', 'The numbers by day') + '</summary><div class="an-scroll"><table class="data"><thead><tr><th scope="col">' + T('Ημέρα', 'Day') + '</th><th scope="col">' + T('Επισκέψεις', 'Visits') + '</th><th scope="col">' + T('Προβολές σελίδων', 'Page views') + '</th></tr></thead><tbody>' +
        rows.slice().reverse().map(function (r) { return '<tr><td>' + esc(dayLong(r.d)) + '</td>' + (r.v == null ? '<td colspan="2">' + T('χωρίς μετρήσεις', 'not measured') + '</td>' : '<td>' + n(r.v) + '</td><td>' + n(r.pv) + '</td>') + '</tr>'; }).join('') + '</tbody></table></div></details>';
    }
    var what = by === 'month' ? T('Μήνας', 'Month') : T('Εβδομάδα', 'Week');
    return '<details class="an-numbers"><summary>' + (by === 'month' ? T('Τα νούμερα ανά μήνα', 'The numbers by month') : T('Τα νούμερα ανά εβδομάδα', 'The numbers by week')) + '</summary><div class="an-scroll"><table class="data"><thead><tr><th scope="col">' + what + '</th><th scope="col">' + T('Επισκέψεις', 'Visits') + '</th><th scope="col">' + T('Προβολές σελίδων', 'Page views') + '</th><th scope="col">' + T('Επισκέψεις ανά ημέρα', 'Visits per day') + '</th></tr></thead><tbody>' +
      rows.slice().reverse().map(function (r) { return '<tr><td>' + esc(by === 'week' ? spanLabel(r.d, r.last) : groupLabel(r)) + '</td>' + (r.v == null ? '<td colspan="3">' + T('χωρίς μετρήσεις', 'not measured') + '</td>' : '<td>' + n(r.tv) + '</td><td>' + n(r.tpv) + '</td><td>' + dec(r.v) + '</td>') + '</tr>'; }).join('') + '</tbody></table></div></details>';
  }
  /** The unmeasured stretches inside a period, said in words. */
  function gapNote(w) {
    var list = (data.gaps || []).filter(function (g) { return g[0] <= w.to && g[1] >= w.from; });
    return list.map(function (g) {
      return T(' Από ' + esc(dayLong(g[0])) + ' έως ' + esc(dayLong(g[1])) + ' δεν υπάρχουν μετρήσεις (κενό στη γραμμή).',
        ' From ' + esc(dayLong(g[0])) + ' to ' + esc(dayLong(g[1])) + ' nothing was measured (a gap in the line).');
    }).join('');
  }
  /** Which counter the line comes from, and where it changes over. */
  function lineSource(w) {
    var src = (data && data.sources) || {}, first = src.site && src.site.first;
    if (src.ga4 && first && w.from < first && first <= w.to) {
      return T(' Έως ' + esc(dayLong(addDay(first, -1))) + ' από το Google Analytics, από ' + esc(dayLong(first)) + ' από τον μετρητή του ιστότοπου.',
        ' Up to ' + esc(dayLong(addDay(first, -1))) + ' from Google Analytics; from ' + esc(dayLong(first)) + ' from the website\'s own visit counter.');
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
      case 'industry': return (PO && PO.industryLabel(it.k, L.lang)) || it.k;
      case 'country': return countryLabel(it.k);
      case 'study': return it.k === '05' ? T('Έως 5 έτη', 'Up to 5 years') : it.k === '10' ? T('10 έτη ή περισσότερα', '10 years or more') : (+it.k) + T(' έτη', ' years');
      // the field of study and the city are stored in Greek: an English page names them in English where it can
      case 'direction': return L.en && DIRECTION_EN[it.k] ? DIRECTION_EN[it.k] : it.name || it.k;
      case 'city': return L.en ? cityLabel(it.name || it.k) : it.name || it.k;
      default: return it.name || it.k;
    }
  }
  function notEnough() {
    return '<p class="an-empty">' + T('Δεν υπάρχουν ακόμα αρκετές απαντήσεις (χρειάζονται τουλάχιστον ' + n(members.minAnswers || 5) + ').',
      'There are not enough answers yet (at least ' + n(members.minAnswers || 5) + ' are needed).') + '</p>';
  }
  function memberDim(dim, title, sub) {
    var d = members.dims && members.dims[dim];
    if (!d) return '';
    var answered = d.answered || 0;
    var note = (sub ? sub + ' · ' : '') + T('Απάντησαν ' + n(answered) + ' από ' + n(members.registered), n(answered) + ' of ' + n(members.registered) + ' answered');
    if (!d.items) return card(title, note, notEnough());
    return card(title, note, bars(d.items.map(function (it) { return { label: label(dim, it), n: it.n, other: it.k === '_other' }; }), { caption: title, total: answered, unit: T('Μέλη', 'Members') }));
  }
  function memberColumns(dim, title, sub) {
    var d = members.dims && members.dims[dim];
    if (!d) return '';
    var note = (sub ? sub + ' · ' : '') + T('Απάντησαν ' + n(d.answered || 0) + ' από ' + n(members.registered), n(d.answered || 0) + ' of ' + n(members.registered) + ' answered');
    if (!d.items) return card(title, note, notEnough());
    var items = d.items.map(function (it) {
      var l = label(dim, it);
      return { n: it.n, short: it.k === '_other' ? T('Λοιπά', 'Other') : dim === 'study' ? (it.k === '05' ? '≤5' : it.k === '10' ? '10+' : String(+it.k)) : String(it.k).replace(/^(\d{4})–\d\d(\d\d)$/, '$1–$2'), tip: [n(it.n) + T(' μέλη', it.n === 1 ? ' member' : ' members'), l] };
    });
    return card(title, note, chartSlot('columns', items, title) +
      table(d.items.map(function (it) { return [label(dim, it), it.n]; }), dim === 'study' ? T('Χρόνια σπουδών', 'Years of study') : T('Περίοδος', 'Period'), T('Μέλη', 'Members')));
  }
  function membersHTML() {
    var h = '<section class="an-part" id="meli" aria-labelledby="an-members-h"><h2 id="an-members-h">' + T('Τα μέλη μας', 'Our members') + '</h2>' +
      '<p class="an-lead">' + T('Ανώνυμα στατιστικά όσων έχουν εγγραφεί στον ιστότοπο, ενημερωμένα κάθε φορά που κάποιος εγγράφεται ή αλλάζει τα στοιχεία του. ' +
      'Μετράμε μόνο σύνολα ανά ερώτηση· ομάδες με λιγότερα από 3 άτομα συγχωνεύονται στα «Λοιπά» και κάθε ερώτηση εμφανίζεται μόνο όταν την έχουν απαντήσει τουλάχιστον 5 άτομα. ' +
      'Δεν δημοσιεύεται κανένα όνομα, e-mail ή στοιχείο ενός συγκεκριμένου ατόμου.',
        'Anonymous statistics about the people registered on the website, updated every time someone registers or changes their details. ' +
        'We count only the totals for each question; groups of fewer than 3 people are merged into “Other”, and a question appears only once at least 5 people have answered it. ' +
        'No name, e-mail address or other detail of any one person is published.') + '</p>';
    if (membersState === 'loading') return h + '<div class="loading"><span class="spinner" aria-hidden="true"></span>' + T('Φόρτωση…', 'Loading…') + '</div></section>';
    if (membersState !== 'ok') return h + '<div class="notice"><strong>' + T('Τα στατιστικά των μελών θα εμφανιστούν σύντομα', 'The members\' statistics will appear soon') + '</strong><p>' +
      T('Μετρώνται αυτόματα από τις εγγραφές στον ιστότοπο.', 'They are counted automatically from the registrations on the website.') + '</p></div></section>';
    var m = members;
    h += '<p class="an-period">' + T('Τρέχουσα εικόνα', 'As things stand') + (m.t ? T(' · ενημερώθηκε ', ' · updated ') + esc(dayLong(String(m.t).slice(0, 10))) : '') + '</p>';
    h += '<div class="an-kpis">' + kpi(n(m.registered), T('Εγγεγραμμένοι', 'Registered')) + kpi(n(m.active), T('Ενεργά μέλη', 'Active members')) +
      kpi(m.dims && m.dims.country && m.dims.country.items ? n(m.dims.country.items.filter(function (x) { return x.k !== '_other'; }).length) : '–', T('Χώρες με τουλάχιστον 3 μέλη', 'Countries with at least 3 members')) +
      kpi(m.dims && m.dims.employer && m.dims.employer.items ? n(m.dims.employer.items.filter(function (x) { return x.k !== '_other'; }).length) : '–', T('Εργοδότες με τουλάχιστον 3 μέλη', 'Employers with at least 3 members')) + '</div>';
    var FIVE = T('ανά πενταετία', 'in five-year periods');
    h += '<div class="an-grid">' +
      memberDim('stage', T('Ιδιότητα', 'Status')) +
      memberDim('direction', T('Κατεύθυνση σπουδών', 'Field of study')) +
      memberColumns('entry', T('Έτος εισαγωγής στη ΣΕΜΦΕ', 'Year of entry to SEMFE'), FIVE) +
      memberColumns('grad', T('Έτος αποφοίτησης', 'Year of graduation'), FIVE) +
      memberColumns('study', T('Χρόνια σπουδών στη ΣΕΜΦΕ', 'Years of study at SEMFE'), T('από την εισαγωγή ως την αποφοίτηση', 'from entry to graduation')) +
      memberDim('gender', T('Φύλο', 'Gender'), T('προαιρετική ερώτηση', 'optional question')) +
      memberDim('industry', T('Κλάδος εργασίας', 'Industry')) +
      memberDim('employer', T('Εργοδότες', 'Employers'), T('όσοι έχουν τουλάχιστον 3 μέλη μας', 'those with at least 3 of our members')) +
      memberDim('country', T('Χώρα', 'Country')) +
      memberDim('city', T('Πόλη', 'City'));
    if (m.growth && m.growth.length) {
      var total = 0;
      var items = m.growth.map(function (g) {
        total += g[1];
        return { n: g[1], short: MONTHS[+g[0].slice(5, 7) - 1] + (g[0].slice(5, 7) === '01' || g === m.growth[0] ? ' ' + g[0].slice(2, 4) : ''), tip: [n(g[1]) + (g[1] === 1 ? T(' νέα εγγραφή', ' new registration') : T(' νέες εγγραφές', ' new registrations')), monthName(g[0]), T('σύνολο ως τότε: ', 'total by then: ') + n(total)] };
      });
      h += card(T('Εγγραφές ανά μήνα', 'Registrations per month'), T('Νέες εγγραφές στον ιστότοπο κάθε μήνα', 'New registrations on the website each month'), chartSlot('columns', items, T('Εγγραφές ανά μήνα', 'Registrations per month')) +
        table(m.growth.map(function (g) { return [monthName(g[0]), g[1]]; }), T('Μήνας', 'Month'), T('Νέες εγγραφές', 'New registrations')), 'an-wide');
    }
    return h + '</div></section>';
  }

  /* ---------------------------------------------------------- the page */
  function render() {
    hideTip();
    var keep = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-range');
    drawn = [];
    chartId = 0;
    app.innerHTML = '<div class="an">' + (data ? trafficHTML() : '<div class="loading"><span class="spinner" aria-hidden="true"></span>' + T('Φόρτωση…', 'Loading…') + '</div>') + membersHTML() + '</div>';
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
