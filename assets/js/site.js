/* SEMFE Alumni: page behaviour shared by every page. No dependencies.
   The phone menu, the motion (gliding links, back to top, numbers that count
   up, blocks that rise into view), the photo lightbox, copy-to-clipboard
   buttons, the announcements filter and the "apply online" switch on the
   support page.
   Written in plain ES5 so it runs in every browser the site supports. */
(function () {
  'use strict';
  var C = window.SEMFE || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_L = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
  var ICON_R = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

  /* ---- phone menu ---- */
  var toggle = $('.nav-toggle'), nav = $('#nav');
  if (toggle && nav) {
    var setOpen = function (open) {
      nav.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Κλείσιμο μενού' : 'Άνοιγμα μενού');
    };
    toggle.addEventListener('click', function (e) { e.stopPropagation(); setOpen(!nav.classList.contains('open')); });
    $$('a', nav).forEach(function (a) { a.addEventListener('click', function () { setOpen(false); }); });
    document.addEventListener('click', function (e) {
      if (nav.classList.contains('open') && !closest(e.target, '.site-header')) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && nav.classList.contains('open')) { setOpen(false); toggle.focus(); }
    });
    // Tab out of the open menu (into the page behind it) closes it: otherwise
    // the focused link is hidden under the menu
    document.addEventListener('focusin', function (e) {
      if (nav.classList.contains('open') && !closest(e.target, '.site-header')) setOpen(false);
    });
    if (window.matchMedia) {
      var mq = window.matchMedia('(min-width: 1101px)');
      var onChange = function () { fitHeader(); setMore(false); if (mq.matches && !tight()) setOpen(false); };
      if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
    }
  }

  /* ---- «Ο Σύλλογος ▾», the drop-down in the header row ----
     On a wide screen only: in the phone menu its links are always listed
     (site.css hides the button there). It closes on Escape (focus back to its
     button), on a click or Tab outside it, and when a link is followed. */
  var more = $('.nav-more'), moreBtn = $('.nav-more-btn');
  function setMore(open) {
    if (!more || !moreBtn) return;
    more.classList.toggle('open', open);
    moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (more && moreBtn) {
    moreBtn.addEventListener('click', function () { setMore(!more.classList.contains('open')); });
    $$('a', more).forEach(function (a) { a.addEventListener('click', function () { setMore(false); }); });
    // in the capture phase: the account button stops its own clicks from
    // reaching the page, and opening that menu must still close this one
    document.addEventListener('click', function (e) {
      if (more.classList.contains('open') && !closest(e.target, '.nav-more')) setMore(false);
    }, true);
    document.addEventListener('focusin', function (e) {
      if (more.classList.contains('open') && !closest(e.target, '.nav-more')) setMore(false);
    });
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && more.classList.contains('open')) { setMore(false); moreBtn.focus(); }
    });
  }

  /* ---- the header row must fit ----
     Above 1100px the links sit in one row. When they do not fit (the web font
     did not load and a wider fallback is used, e.g. where Google Fonts is
     blocked, or the reader has a larger default text size), switch to the
     menu button (html.nav-tight, see site.css) instead of spilling past the
     edge. Measured again when fonts arrive, on resize and when the account
     button changes. */
  var headerWrap = $('.site-header .wrap'), docEl = document.documentElement;
  function tight() { return docEl.classList.contains('nav-tight'); }
  function headerOver() {
    // the row's own items: the drop-down (its button) and the three links
    var links = Array.prototype.slice.call(nav.children), first = links[0], brandRight = 0;
    if (!first) return false;
    $$('.brand-text span').forEach(function (sp) { var r = sp.getBoundingClientRect(); brandRight = Math.max(brandRight, r.right, r.left + sp.scrollWidth); });
    var top = first.getBoundingClientRect().top;
    return headerWrap.scrollWidth > headerWrap.clientWidth + 1 ||
      brandRight > first.getBoundingClientRect().left - 6 ||
      links.some(function (a) { return a.getBoundingClientRect().top > top + 2; });
  }
  function fitHeader() {
    if (!headerWrap || !nav || !window.matchMedia) return;
    var was = tight(), small = docEl.classList.contains('hdr-small');
    // measured at FULL size, the widest the row gets (with transitions off, or
    // the measurement would read the start of the animation): a row that fits
    // there fits slimmed down too, so the links keep one style while scrolling
    docEl.classList.add('hdr-measure');
    docEl.classList.remove('nav-tight', 'nav-compact', 'hdr-small');
    if (window.matchMedia('(min-width: 1101px)').matches && headerOver()) {
      docEl.classList.add('nav-compact');             // first: a little less space around each link
      if (headerOver()) docEl.classList.add('nav-tight');   // still too wide: the menu button
    }
    if (small) docEl.classList.add('hdr-small');
    headerWrap.getBoundingClientRect();                // settle the sizes before transitions come back
    docEl.classList.remove('hdr-measure');
    if (was !== tight()) {
      if (toggle && setOpen) setOpen(false);     // the label too, not only aria-expanded
      setMore(false);
    }
  }
  var fitQueued = false;
  function queueFit() { if (fitQueued) return; fitQueued = true; (window.requestAnimationFrame || setTimeout)(function () { fitQueued = false; fitHeader(); }); }
  fitHeader();
  window.addEventListener('resize', queueFit);
  if (document.fonts) {
    if (document.fonts.ready) document.fonts.ready.then(queueFit);
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', queueFit);
  }
  var slot = $('#acct-slot');
  if (slot && window.MutationObserver) new MutationObserver(queueFit).observe(slot, { childList: true, subtree: true });

  /* ---- the header slims down once the page is scrolled (html.hdr-small) ----
     Two thresholds, not one: the header is sticky, so slimming it moves the
     page up by 12px (and the browser may move the scroll position with it);
     a single threshold would flicker right at it. Left alone while a dialog
     has locked the page, which then reports a scroll position of 0. */
  var SMALL_AT = 48, FULL_AT = 8, sizeQueued = false;
  function sizeHeader() {
    sizeQueued = false;
    if (document.body && document.body.classList.contains('modal-open')) return;
    var y = window.pageYOffset || docEl.scrollTop || 0, small = docEl.classList.contains('hdr-small');
    if (!small && y > SMALL_AT) docEl.classList.add('hdr-small');
    else if (small && y < FULL_AT) docEl.classList.remove('hdr-small');
  }
  window.addEventListener('scroll', function () {
    if (sizeQueued) return;
    sizeQueued = true;
    (window.requestAnimationFrame || setTimeout)(sizeHeader);
  }, { passive: true });
  sizeHeader();                                        // a page reloaded half-way down starts slim

  /* ---- motion: the way www.stouras.com and operationsacademia.org move ----
     1. A link to a place on the SAME page glides there instead of jumping:
        slow to start, faster, slow to arrive (the cosine "swing" curve that
        www.stouras.com scrolls with). The reader's own wheel, touch or key
        takes over at once.
     2. A round "back to top" button appears once the page is well scrolled.
     3. Numbers marked data-count count up from zero when they come into view.
     4. Blocks further down a page rise into view as the reader reaches them.
     None of it when the reader asks for less motion (prefers-reduced-motion).
     Nothing is ever hidden from a reader without JavaScript, or on paper:
     a block is hidden only by this script, only while it is still below the
     screen, and site.css shows everything when printing. */
  function motionOK() { return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function pageY() { return window.pageYOffset || docEl.scrollTop || 0; }
  function jumpTo(y) {
    var sb = docEl.style.scrollBehavior;
    docEl.style.scrollBehavior = 'auto';               // site.css asks for smooth; this must be instant
    window.scrollTo(0, y);
    docEl.style.scrollBehavior = sb;
  }
  // where an element should come to rest: just under the sticky header. Read
  // again on every frame: the header slims down on the way, pictures load.
  function landingY(el) {
    if (!el || el === document.body || el === docEl) return 0;
    var hd = $('.site-header'), gap = (hd ? hd.getBoundingClientRect().height : 0) + 12;
    var y = el.getBoundingClientRect().top + pageY() - gap;
    return Math.max(0, Math.min(Math.round(y), docEl.scrollHeight - window.innerHeight));
  }
  var glide = null, INTERRUPT = ['wheel', 'touchstart', 'mousedown', 'keydown'];
  function glideTo(el, done) {
    if (glide) glide.stop();
    var from = pageY(), dist = Math.abs(landingY(el) - from);
    if (!motionOK() || dist < 2 || !window.requestAnimationFrame) {
      // straight there; the header is slim down the page, so measure with it slim
      if (landingY(el) > SMALL_AT) docEl.classList.add('hdr-small');
      jumpTo(landingY(el));
      if (done) done();
      return;
    }
    // about 0.8s for a screen or two, longer for a long way, never over 1.3s
    var ms = Math.min(1300, Math.max(650, 480 + dist * 0.3)), t0 = null, stopped = false, sb = docEl.style.scrollBehavior;
    var me = { stop: function () {
      if (stopped) return;
      stopped = true;
      INTERRUPT.forEach(function (t) { window.removeEventListener(t, me.stop, true); });
      docEl.style.scrollBehavior = sb;
      if (glide === me) glide = null;
    } };
    glide = me;
    docEl.style.scrollBehavior = 'auto';
    INTERRUPT.forEach(function (t) { window.addEventListener(t, me.stop, { capture: true, passive: true }); });
    requestAnimationFrame(function step(ts) {
      if (stopped) return;
      if (document.body.classList.contains('modal-open')) { me.stop(); return; }   // a dialog has the page now
      if (t0 === null) t0 = ts;
      var t = Math.min(1, (ts - t0) / ms);
      window.scrollTo(0, from + (landingY(el) - from) * (0.5 - Math.cos(t * Math.PI) / 2));
      if (t < 1) requestAnimationFrame(step);
      else { me.stop(); if (done) done(); }
    });
  }
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = closest(e.target, 'a[href*="#"]');
    if (!a || a.className.indexOf('skip') !== -1 || a.hasAttribute('data-no-glide') || (a.target && a.target !== '_self')) return;
    if (a.host !== location.host || a.search !== location.search || a.pathname.replace(/^\/?/, '/') !== location.pathname) return;
    var id = '';
    try { id = decodeURIComponent(a.hash.slice(1)); } catch (err) { return; }
    var el = id && document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    if (location.hash !== a.hash && history.pushState) { try { history.pushState(null, '', a.hash); } catch (err) {} }
    glideTo(el, function () {
      // the keyboard follows the reader there, as the browser's own jump does
      if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
        el.setAttribute('tabindex', '-1');
        el.setAttribute('data-glide-focus', '');
      }
      try { el.focus({ preventScroll: true }); } catch (err) {}
    });
  });
  if (document.body) {
    var toTop = document.createElement('button'), topShown = false, topQueued = false;
    toTop.type = 'button';
    toTop.className = 'to-top';
    toTop.setAttribute('aria-label', 'Επιστροφή στην αρχή της σελίδας');
    toTop.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
    document.body.appendChild(toTop);
    var placeTop = function () {
      topQueued = false;
      var want = pageY() > window.innerHeight * 1.2;
      if (want !== topShown) { topShown = want; toTop.classList.toggle('is-shown', want); }
    };
    window.addEventListener('scroll', function () {
      if (topQueued) return;
      topQueued = true;
      (window.requestAnimationFrame || setTimeout)(placeTop);
    }, { passive: true });
    placeTop();
    toTop.addEventListener('click', function () {
      glideTo(document.body, function () {
        if (location.hash && history.replaceState) { try { history.replaceState(null, '', location.pathname + location.search); } catch (err) {} }
        var brand = $('.brand');                         // the button is gone now: the focus goes to the top of the page
        if (brand) { try { brand.focus({ preventScroll: true }); } catch (err) {} }
      });
    });
  }

  // 3. numbers: "3.000+" runs 0 → 3.000 and keeps its "+"; a year runs as a
  // year. A screen reader is given the final figure only.
  $$('[data-count]').forEach(function (el) {
    var full = (el.textContent || '').replace(/\s+/g, ' ').trim();
    var m = /^(\d{1,3}(?:\.\d{3})+|\d+)(.*)$/.exec(full);
    if (!m || !motionOK() || !('IntersectionObserver' in window) || !window.requestAnimationFrame) { el.classList.add('is-counting'); return; }
    var target = parseInt(m[1].replace(/\./g, ''), 10), grouped = m[1].indexOf('.') !== -1, rest = m[2];
    var fmt = function (v) { var s = String(v); return (grouped ? s.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : s) + rest; };
    var sr = document.createElement('span'), shown = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = full;
    shown.setAttribute('aria-hidden', 'true');
    shown.textContent = fmt(0);
    el.textContent = '';
    el.appendChild(sr);
    el.appendChild(shown);
    el.classList.add('is-counting');
    var io = new IntersectionObserver(function (entries) {
      if (!entries.some(function (en) { return en.isIntersecting; })) return;
      io.disconnect();
      var t0 = null;
      requestAnimationFrame(function tick(ts) {
        if (t0 === null) t0 = ts;
        var t = Math.min(1, (ts - t0) / 1100);
        shown.textContent = fmt(Math.round(target * (1 - Math.pow(1 - t, 3))));
        if (t < 1) requestAnimationFrame(tick);
      });
    }, { threshold: 0.35 });
    io.observe(el);
  });

  // 4. blocks rise into view. Only what is still below the screen when the page
  // opens is held back: nothing the reader has already seen ever disappears.
  // Not on the member pages, whose content is drawn by their own scripts.
  var RISE = '.section-head, .two-col > *, .cards > *, .stats > *, .goals > li, .qa > li, .milestones > li, .people > *, .people-mini, ' +
    '.posts > *, .docs > *, .doc-group, .gallery > *, .steps > *, .pay-grid > *, .section-foot, .cta .wrap > *';
  var main = $('#main');
  if (main && motionOK() && 'IntersectionObserver' in window && !document.body.hasAttribute('data-firestore')) {
    var held = [], vh = window.innerHeight || docEl.clientHeight;
    $$(RISE, main).forEach(function (el) {
      if (closest(el, '.hero, .page-hero') || (el.parentNode && closest(el.parentNode, '.reveal'))) return;
      if (el.getBoundingClientRect().top < vh) return;   // on screen already, or not shown at all
      el.classList.add('reveal');
      held.push(el);
    });
    var rise = new IntersectionObserver(function (entries) {
      var n = 0;
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        rise.unobserve(en.target);
        var el = en.target, delay = Math.min(n++, 5) * 80;       // a row of cards arrives one after another
        if (delay) el.style.transitionDelay = delay + 'ms';
        el.classList.add('is-in');
        // then the block goes back to being itself (its own hover effects included)
        setTimeout(function () { el.classList.remove('reveal'); el.classList.remove('is-in'); el.style.transitionDelay = ''; }, 900 + delay);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
    held.forEach(function (el) { rise.observe(el); });
  }

  /* ---- a printout shows every collapsible list open (the aims on the home
     page). They open one at a time on screen (name="…"), so the name is put
     aside while printing, or opening them all would close all but one. ---- */
  window.addEventListener('beforeprint', function () {
    $$('details:not([open])').forEach(function (d) {
      d.setAttribute('data-print-open', d.getAttribute('name') || '');
      d.removeAttribute('name');
      d.open = true;
    });
  });
  window.addEventListener('afterprint', function () {
    $$('details[data-print-open]').forEach(function (d) {
      d.open = false;
      if (d.getAttribute('data-print-open')) d.setAttribute('name', d.getAttribute('data-print-open'));
      d.removeAttribute('data-print-open');
    });
  });

  /* ---- copy buttons (IBAN, BIC) ---- */
  $$('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var src = $(btn.getAttribute('data-copy'));
      var text = src ? src.textContent.trim() : '';
      copyText(text, function (ok) {
        if (btn._orig == null) btn._orig = btn.innerHTML;   // the label, recorded once
        clearTimeout(btn._t);                               // a second click replaces the pending reset
        var msg = ok ? 'Αντιγράφηκε ✓' : 'Επιλέξτε και αντιγράψτε';
        btn.textContent = msg;
        btn.classList.toggle('done', ok);
        announce(msg);
        btn._t = setTimeout(function () { btn.innerHTML = btn._orig; btn.classList.remove('done'); }, 2200);
      });
    });
  });

  /* ---- the footer's year: never behind the calendar, without a rebuild each January ---- */
  $$('[data-year]').forEach(function (el) { var y = new Date().getFullYear(); if (+el.textContent < y) el.textContent = String(y); });

  /* ---- announcements filter ---- */
  var filter = $('[data-post-filter]'), list = $('#post-list'), count = $('[data-post-count]');
  if (filter && list) {
    filter.hidden = false;
    var buttons = $$('button', filter);
    buttons.forEach(function (b) {
      b.addEventListener('click', function () {
        var cat = b.getAttribute('data-cat'), shown = 0;
        buttons.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        $$('.post-card', list).forEach(function (card) {
          card.hidden = !!cat && card.getAttribute('data-cat') !== cat;
          if (!card.hidden) shown++;
        });
        if (count) count.textContent = shown + (shown === 1 ? ' ανακοίνωση' : ' ανακοινώσεις');
      });
    });
    // blog/?cat=Εκδηλώσεις opens on that category (the old site's category
    // pages forward here, see LEGACY in tools/build.mjs)
    var want = null;
    try { want = new URLSearchParams(location.search).get('cat'); } catch (e) {}
    if (want) buttons.forEach(function (b) { if (b.getAttribute('data-cat') === want) b.click(); });
  }

  /* ---- support page: apply online once sign-in is switched on ---- */
  var online = $('[data-apply-online]'), legacy = $('[data-apply-legacy]');
  if (online && legacy && firebaseConfigured()) { online.hidden = false; legacy.hidden = true; }

  /* ---- photo lightbox ---- */
  $$('[data-gallery]').forEach(function (gal) {
    var items = $$('a', gal);
    items.forEach(function (a, i) {
      // a distinct accessible name for each photo link
      var im = a.querySelector('img');
      var base = (im && im.alt) || a.getAttribute('data-caption') || 'Φωτογραφία';
      a.setAttribute('aria-label', base + ' (φωτογραφία ' + (i + 1) + ' από ' + items.length + ')');
      a.addEventListener('click', function (e) {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return; // let "open in new tab" work
        e.preventDefault();
        openLightbox(items, i);
      });
    });
  });

  function openLightbox(items, start) {
    var idx = start, opener = items[start];     // Safari does not focus links on click
    var box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Φωτογραφία');
    box.innerHTML = '<div class="lb-stage"><img alt=""></div><div class="lb-cap" aria-live="polite"></div>' +
      '<span class="lb-count" aria-live="polite"></span>' +
      '<button type="button" class="lb-prev" aria-label="Προηγούμενη φωτογραφία">' + ICON_L + '</button>' +
      '<button type="button" class="lb-next" aria-label="Επόμενη φωτογραφία">' + ICON_R + '</button>' +
      '<button type="button" class="lb-close" aria-label="Κλείσιμο">' + ICON_X + '</button>';
    document.body.appendChild(box);
    lockScroll();
    var img = $('img', box), cap = $('.lb-cap', box), count = $('.lb-count', box);
    var show = function (i) {
      idx = (i + items.length) % items.length;
      var a = items[idx];
      img.src = a.getAttribute('href');
      img.alt = (a.querySelector('img') || {}).alt || '';
      cap.textContent = a.getAttribute('data-caption') || '';
      count.textContent = (idx + 1) + ' / ' + items.length;
    };
    var close = function () {
      document.removeEventListener('keydown', onKey);
      box.parentNode.removeChild(box);
      unlockScroll();
      if (opener && opener.focus) opener.focus();
    };
    var onKey = function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') close();
      else if (e.key === 'ArrowLeft') show(idx - 1);
      else if (e.key === 'ArrowRight') show(idx + 1);
      else if (e.key === 'Tab') trapTab(e, box);
    };
    $('.lb-close', box).addEventListener('click', close);
    $('.lb-prev', box).addEventListener('click', function () { show(idx - 1); });
    $('.lb-next', box).addEventListener('click', function () { show(idx + 1); });
    box.addEventListener('click', function (e) { if (e.target === box || e.target.className === 'lb-stage') close(); });
    // swipe on touch screens
    var x0 = null;
    box.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    box.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 50) show(idx + (dx < 0 ? 1 : -1));
    });
    document.addEventListener('keydown', onKey);
    show(idx);
    $('.lb-close', box).focus();
  }

  /* ---- helpers, shared with auth.js through window.SEMFE_UTIL ---- */
  function closest(el, sel) {
    while (el && el.nodeType === 1) {
      if ((el.matches || el.msMatchesSelector || el.webkitMatchesSelector).call(el, sel)) return el;
      el = el.parentNode;
    }
    return null;
  }
  function trapTab(e, container) {
    var f = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', container)
      .filter(function (el) { return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    // focus on <body> (after a click on plain text, or on a button in Safari) is pulled back in
    if (f.indexOf(document.activeElement) === -1) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function copyText(text, done) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallback()); });
    } else done(fallback());
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '-1000px';
        document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
        var ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
      } catch (e) { return false; }
    }
  }
  /* one shared polite live region for short confirmations */
  var live;
  function announce(msg) {
    if (!live) { live = document.createElement('span'); live.className = 'sr-only'; live.setAttribute('role', 'status'); document.body.appendChild(live); }
    live.textContent = '';
    setTimeout(function () { live.textContent = msg; }, 50);   // clear then set, so a repeat is read again
  }
  /* stop the page scrolling under a dialog; position:fixed also works on iOS 15,
     where overflow:hidden on <body> does not */
  function lockScroll() {
    var b = document.body;
    if (b.classList.contains('modal-open')) return;
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    b.setAttribute('data-lock-y', String(y));
    b.style.position = 'fixed'; b.style.top = (-y) + 'px'; b.style.width = '100%';
    b.classList.add('modal-open');
  }
  function unlockScroll() {
    var b = document.body, h = document.documentElement;
    if (!b.classList.contains('modal-open')) return;
    var y = +b.getAttribute('data-lock-y') || 0;
    b.classList.remove('modal-open'); b.removeAttribute('data-lock-y');
    b.style.position = ''; b.style.top = ''; b.style.width = '';
    var sb = h.style.scrollBehavior; h.style.scrollBehavior = 'auto';
    window.scrollTo(0, y);
    h.style.scrollBehavior = sb;
  }
  function firebaseConfigured() {
    var f = C.FIREBASE || {};
    return !!(f.apiKey && f.projectId && String(f.apiKey).indexOf('PASTE_') === -1 && String(f.projectId).indexOf('PASTE_') === -1);
  }
  window.SEMFE_UTIL = { closest: closest, trapTab: trapTab, copyText: copyText, firebaseConfigured: firebaseConfigured,
    announce: announce, lockScroll: lockScroll, unlockScroll: unlockScroll, lightbox: openLightbox };
})();
