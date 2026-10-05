/* SEMFE Alumni: the «Τι νέο» list. Who may see an entry, and the admins'
   decisions about it. ONE definition, loaded by the page
   (<script src="assets/js/news.js"> -> window.SEMFE_NEWS) and by the tests
   and tools/check.mjs (require -> module.exports), so they cannot disagree.

   THE MODEL (the one operationsacademia.org uses):
   * changelog.json, in the repository, says WHAT changed. Claude adds an
     entry with every change people would notice: it is a SUGGESTION.
   * Firestore newsOverrides/{entry id} holds an admin's DECISION about it,
     and nothing else:
       status 'approved'   public: every visitor sees it
       status 'pending'    waiting (also: no document at all): admins only
       status 'removed'    off the list; admins find it under «Αφαιρεμένα»,
                           one click from Επαναφορά
       title / summary     an admin's own wording ('' = the changelog's)
   * NOTHING IS PUBLIC WITHOUT AN ADMIN'S APPROVAL. A missing or unreadable
     decision means "waiting", so a failure can only hide an entry, never
     publish one.

   Written in ES5 for every browser the site supports. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SEMFE_NEWS = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COLLECTION = 'newsOverrides';
  var APPROVED = 'approved', PENDING = 'pending', REMOVED = 'removed';
  /* every key a decision may carry; tools/check.mjs pins this list against
     the hasOnly() list in firestore.rules */
  var DOC_KEYS = ['status', 'title', 'summary', 't', 'by'];
  var TITLE_MAX = 200, SUMMARY_MAX = 2000;
  var ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  // a full https address, or a page of this site relative to its root
  var URL_RE = /^(https:\/\/[^\s"'<>]+|[a-z0-9_#-][a-z0-9_\/#?=&.-]*)$/i;

  function str(v) { return typeof v === 'string' ? v : ''; }

  /** approved | pending | removed. No document, or one that says nothing
      known, is pending: withheld. */
  function statusOf(doc) {
    var s = doc && doc.status;
    return s === APPROVED || s === REMOVED ? s : PENDING;
  }

  /** Is this a well-formed changelog entry? (tools/check.mjs reports the bad ones) */
  function problem(e) {
    if (!e || typeof e !== 'object') return 'not an object';
    if (!ID_RE.test(str(e.id))) return 'id must be lowercase letters, digits and dashes';
    if (!DAY_RE.test(str(e.date))) return 'date must be YYYY-MM-DD';
    if (!str(e.title).trim() || e.title.length > TITLE_MAX) return 'title missing or longer than ' + TITLE_MAX;
    if (e.summary != null && (typeof e.summary !== 'string' || e.summary.length > SUMMARY_MAX)) return 'summary longer than ' + SUMMARY_MAX;
    if (e.url != null && !URL_RE.test(str(e.url))) return 'url must be https://… or a page of the site (whats-new/, #skopos)';
    if (e.en != null && (typeof e.en !== 'object' || !str(e.en.title).trim() || e.en.title.length > TITLE_MAX ||
      (e.en.summary != null && (typeof e.en.summary !== 'string' || e.en.summary.length > SUMMARY_MAX)))) return 'en must be { title, summary? } in English, within the same lengths';
    return '';
  }

  /** The entry as it should read: an admin's wording where they gave one.
      lang 'en' (the English copy of the page) reads the entry's own English
      text (e.en.title / e.en.summary in changelog.json) when it has one and
      no admin has reworded it: an admin's wording is shown as they wrote it.
      `lang` in the result says which language title and summary are in;
      `el` is the Greek reading (what an admin edits). */
  function reads(e, doc, lang) {
    var t = str(doc && doc.title).trim(), s = str(doc && doc.summary).trim();
    var el = { title: t || e.title, summary: s || str(e.summary) };
    var en = lang === 'en' && !(t || s) && e.en && str(e.en.title).trim() ? e.en : null;
    return {
      id: e.id, date: e.date, url: str(e.url),
      title: en ? str(en.title) : el.title, summary: en ? str(en.summary) : el.summary,
      lang: en ? 'en' : 'el', el: el,
      original: { title: e.title, summary: str(e.summary) },
      edited: !!(t || s), status: statusOf(doc)
    };
  }

  /** The changelog, split by decision. Each list newest first (the
      changelog's own order breaks ties); malformed or repeated entries are
      left out. lang: as for reads(). */
  function split(updates, docs, lang) {
    var out = { approved: [], pending: [], removed: [] }, seen = {}, list = [];
    (Object.prototype.toString.call(updates) === '[object Array]' ? updates : []).forEach(function (e, i) {
      if (problem(e) || seen[e.id]) return;
      seen[e.id] = true;
      list.push({ e: e, i: i });
    });
    list.sort(function (a, b) { return a.e.date < b.e.date ? 1 : a.e.date > b.e.date ? -1 : a.i - b.i; });
    list.forEach(function (x) {
      var r = reads(x.e, docs && docs[x.e.id], lang);
      out[r.status].push(r);
    });
    return out;
  }

  /** What to write for an admin's action. 'edit' keeps the entry's current
      status (the rules want one on every document); an empty field means
      "the changelog's own text". Server time and author are added by the page. */
  function patchFor(action, current, fields) {
    if (action === 'approve' || action === 'restore') return { status: APPROVED };
    if (action === 'remove') return { status: REMOVED };
    if (action === 'edit') {
      var f = fields || {};
      return {
        status: statusOf(current),
        title: str(f.title).trim().slice(0, TITLE_MAX),
        summary: str(f.summary).trim().slice(0, SUMMARY_MAX)
      };
    }
    throw new Error('unknown action ' + action);
  }

  /** The public read: Firestore's REST address for the whole collection. No
      Firebase library, no cookies, nothing stored in the browser. */
  function restUrl(projectId, apiKey) {
    return 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(projectId) +
      '/databases/(default)/documents/' + COLLECTION + '?pageSize=300' + (apiKey ? '&key=' + encodeURIComponent(apiKey) : '');
  }
  /** {id: {status, title, summary}} from that REST answer. */
  function parseRest(json) {
    var out = {};
    ((json && json.documents) || []).forEach(function (d) {
      var id = String(d.name || '').split('/').pop(), f = d.fields || {};
      if (!ID_RE.test(id)) return;
      var v = function (k) { return f[k] && typeof f[k].stringValue === 'string' ? f[k].stringValue : ''; };
      out[id] = { status: v('status'), title: v('title'), summary: v('summary') };
    });
    return out;
  }

  return {
    COLLECTION: COLLECTION, APPROVED: APPROVED, PENDING: PENDING, REMOVED: REMOVED,
    DOC_KEYS: DOC_KEYS, TITLE_MAX: TITLE_MAX, SUMMARY_MAX: SUMMARY_MAX, ID_RE: ID_RE,
    statusOf: statusOf, problem: problem, reads: reads, split: split, patchFor: patchFor,
    restUrl: restUrl, parseRest: parseRest
  };
}));
