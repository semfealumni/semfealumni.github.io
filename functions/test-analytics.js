/* Offline tests for the «Στατιστικά» page's server side: netorg.js (which
   university or company a network belongs to), site-visits.js (what one
   page view adds to the day's counters) and member-stats.js (the members'
   anonymous statistics). No network, no Firebase. Run: npm test */
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const N = require('./netorg');
const V = require('./site-visits');
const S = require('./member-stats');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('ok    ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e && e.stack || e)); }
}

/* an RDAP answer, trimmed to what registrationFacts reads */
function rdap(registrant, emails, name) {
  const ents = [];
  if (registrant) ents.push({ roles: ['registrant'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', registrant]]] });
  for (const e of emails || []) ents.push({ roles: ['technical', 'administrative'], vcardArray: ['vcard', [['fn', {}, 'text', 'NOC'], ['email', {}, 'text', e]]] });
  return { name: name || 'NET', entities: ents };
}

/* ---------------------------------------------------------------- netorg */
t('the registrable domain of a host', () => {
  assert.strictEqual(N.registrableDomain('gw.central.ntua.gr.'), 'ntua.gr');
  assert.strictEqual(N.registrableDomain('it.ox.ac.uk'), 'ox.ac.uk');
  assert.strictEqual(N.registrableDomain('mail.example.co.uk'), 'example.co.uk');
  assert.strictEqual(N.registrableDomain('host.example.com.cy'), 'example.com.cy');
  assert.strictEqual(N.registrableDomain('10.1.2.3'), '');
  assert.strictEqual(N.registrableDomain('not a host'), '');
  assert.strictEqual(N.registrableDomain('ac.uk'), '');
});

t('the visitor address is the LAST routable entry (a spoofed first entry is ignored)', () => {
  assert.strictEqual(N.clientIp('1.2.3.4, 147.102.1.1'), '147.102.1.1');
  assert.strictEqual(N.clientIp('147.102.1.1, 10.0.0.1'), '147.102.1.1');
  assert.strictEqual(N.clientIp('[2001:648:2000::1]:443'), '2001:648:2000::1');
  assert.strictEqual(N.clientIp('::ffff:147.102.1.1'), '147.102.1.1');
  assert.strictEqual(N.clientIp('127.0.0.1, 192.168.1.4, 100.64.0.1'), '');
  assert.strictEqual(N.clientIp(''), '');
});

t('reverse DNS names Greek universities by their Greek name, and never a company', () => {
  assert.deepStrictEqual(N.classifyHost('gw.central.ntua.gr'), { kind: 'university', name: 'Εθνικό Μετσόβιο Πολυτεχνείο', domain: 'ntua.gr' });
  assert.strictEqual(N.classifyHost('lab1.cs.uoa.gr').name, 'Εθνικό και Καποδιστριακό Πανεπιστήμιο Αθηνών');
  const abroad = N.classifyHost('ws-12.stanford.edu');
  assert.strictEqual(abroad.kind, 'university');
  assert.strictEqual(abroad.name, 'stanford.edu');
  assert.deepStrictEqual(N.classifyHost('nat.grnet.gr'), { kind: 'academic' });
  assert.strictEqual(N.classifyHost('ppp-94-66-1-2.home.otenet.gr'), null);
  assert.strictEqual(N.classifyHost('vpn.siemens.com'), null, 'a company is named only from its registration');
  assert.strictEqual(N.classifyHost(''), null);
});

t('a registration names universities, companies, and never an internet provider', () => {
  // a Greek university: known by its contact domain
  assert.deepStrictEqual(N.classifyRegistration(rdap('National Technical University of Athens', ['noc@noc.ntua.gr'])),
    { kind: 'university', name: 'Εθνικό Μετσόβιο Πολυτεχνείο', domain: 'ntua.gr' });
  // a university abroad, named from the registration
  const st = N.classifyRegistration(rdap('Stanford University', ['net@stanford.edu']));
  assert.strictEqual(st.kind, 'university');
  assert.strictEqual(st.name, 'Stanford University');
  // ALL CAPS is written in ordinary case
  assert.strictEqual(N.classifyRegistration(rdap('UNIVERSITY OF THE AEGEAN', [])).name, 'University of the Aegean');
  // a research network: academic, attributed to nobody
  assert.deepStrictEqual(N.classifyRegistration(rdap('GRNET S.A.', ['noc@grnet.gr'])), { kind: 'academic' });
  // a company that registers its own network
  assert.deepStrictEqual(N.classifyRegistration(rdap('PIRAEUS BANK S.A.', ['hostmaster@piraeusbank.gr'])), { kind: 'company', name: 'Piraeus Bank S.A.' });
  assert.deepStrictEqual(N.classifyRegistration(rdap('Siemens AG', ['noc@siemens.com'])), { kind: 'company', name: 'Siemens AG' });
  // providers, clouds, VPNs and security proxies: nothing
  for (const [who, mail] of [
    ['Hellenic Telecommunications Organization S.A.', 'noc@ote.gr'],
    ['Vodafone-panafon Hellenic Telecommunications Company SA', 'noc@vodafone.gr'],
    ['Forthnet S.A.', 'abuse@forthnet.gr'],
    ['WIND HELLAS TELECOMMUNICATIONS S.A.', 'noc@wind.gr'],
    ['Comcast Cable Communications, LLC', 'abuse@comcast.net'],
    ['Zscaler, Inc.', 'noc@zscaler.com'],
    ['Cloudflare, Inc.', 'noc@cloudflare.com'],
    ['Google LLC', 'network-abuse@google.com'],
    ['Amazon Technologies Inc.', 'abuse@amazonaws.com'],
    ['Hetzner Online GmbH', 'abuse@hetzner.com'],
    ['Example Hosting Ltd', 'noc@example-hosting.net']
  ]) assert.strictEqual(N.classifyRegistration(rdap(who, [mail])), null, who);
  // a provider's contact domain alone is enough to say no
  assert.strictEqual(N.classifyRegistration(rdap('Some Customer', ['noc@otenet.gr'])), null);
  // two registrants: we cannot say which
  assert.strictEqual(N.classifyRegistration({ entities: [
    { roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', 'Alpha SA']]] },
    { roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', 'Beta SA']]] }] }), null);
  // nothing usable, or a failed look-up
  assert.strictEqual(N.classifyRegistration(rdap('', ['noc@ripe.net'])), null);
  assert.strictEqual(N.classifyRegistration(null), null);
  assert.strictEqual(N.classifyRegistration('not json'), null);
});

t('one visit: the curated name first, then the registration, then the academic domain', () => {
  assert.strictEqual(N.place('x.ntua.gr', rdap('Something Else', [])).name, 'Εθνικό Μετσόβιο Πολυτεχνείο');
  assert.strictEqual(N.place('host.stanford.edu', rdap('Stanford University', [])).name, 'Stanford University');
  assert.strictEqual(N.place('host.unknown.edu', null).name, 'unknown.edu');
  assert.deepStrictEqual(N.place('', rdap('Siemens AG', ['noc@siemens.com'])), { kind: 'company', name: 'Siemens AG' });
  assert.strictEqual(N.place('dsl.otenet.gr', rdap('Hellenic Telecommunications Organization S.A.', ['noc@ote.gr'])), null);
  assert.strictEqual(N.place('', null), null);
});

t('a very large or strange registration is walked within bounds', () => {
  const deep = { entities: [] };
  let cur = deep;
  for (let i = 0; i < 50; i++) { const e = { roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', 'Deep ' + i]]], entities: [] }; cur.entities.push(e); cur = e; }
  const f = N.registrationFacts(deep);
  assert.ok(f.names.length <= 6, 'depth is bounded');
  const wide = { entities: Array.from({ length: 1000 }, (_, i) => ({ roles: ['technical'], vcardArray: ['vcard', [['email', {}, 'text', 'a@d' + i + '.com']]] })) };
  assert.ok(N.registrationFacts(wide).domains.length <= 200, 'breadth is bounded');
});

/* ----------------------------------------------------------- site-visits */
const KNOWN = ['/', '/blog/', '/analytics/', '/blog/2025/01/27/2025-kopi-pitas/'];

t('a page path is counted only when the site has that page', () => {
  assert.strictEqual(V.normPath('/', KNOWN), '/');
  assert.strictEqual(V.normPath('/index.html', KNOWN), '/');
  assert.strictEqual(V.normPath('/blog', KNOWN), '/blog/');
  assert.strictEqual(V.normPath('/blog/?cat=Events#x', KNOWN), '/blog/');
  assert.strictEqual(V.normPath('//blog//', KNOWN), '/blog/');
  assert.strictEqual(V.normPath('/blog/2025/01/27/2025-kopi-pitas/index.html', KNOWN), '/blog/2025/01/27/2025-kopi-pitas/');
  assert.strictEqual(V.normPath('/wp-login.php', KNOWN), 'other');
  assert.strictEqual(V.normPath('/' + 'x'.repeat(5000), KNOWN), 'other');
  assert.strictEqual(V.normPath(null, KNOWN), '/');
});

t('the message is parsed defensively', () => {
  assert.deepStrictEqual(V.parseMessage('{"p":"/blog/","s":1,"r":"www.google.com"}'), { path: '/blog/', first: true, ref: 'www.google.com' });
  assert.deepStrictEqual(V.parseMessage('{"p":"/","s":0}'), { path: '/', first: false, ref: '' });
  assert.strictEqual(V.parseMessage('nonsense'), null);
  assert.strictEqual(V.parseMessage(''), null);
  assert.strictEqual(V.parseMessage('[1,2]').first, false);
  assert.strictEqual(V.parseMessage('{"p":"/","s":1,"r":"<script>"}').ref, '', 'a referrer that is not a host name is dropped');
  assert.strictEqual(V.parseMessage('{"p":5,"s":"1"}').path, '/');
});

t('how a visit arrived, what it was read on, and crawlers', () => {
  const own = ['semfealumni.gr', 'www.semfealumni.gr'];
  assert.strictEqual(V.channelOf('', own), 'direct');
  assert.strictEqual(V.channelOf('www.semfealumni.gr', own), 'direct');
  assert.strictEqual(V.channelOf('www.google.gr', own), 'search');
  assert.strictEqual(V.channelOf('duckduckgo.com', own), 'search');
  assert.strictEqual(V.channelOf('l.facebook.com', own), 'social');
  assert.strictEqual(V.channelOf('www.linkedin.com', own), 'social');
  assert.strictEqual(V.channelOf('mail.google.com', own), 'email');
  assert.strictEqual(V.channelOf('www.ntua.gr', own), 'other');
  assert.strictEqual(V.deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'mobile');
  assert.strictEqual(V.deviceOf('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari'), 'mobile');
  assert.strictEqual(V.deviceOf('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), 'tablet');
  assert.strictEqual(V.deviceOf('Mozilla/5.0 (Linux; Android 14; SM-X710) Safari'), 'tablet');
  assert.strictEqual(V.deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130'), 'desktop');
  assert.ok(V.isBot('Mozilla/5.0 (compatible; Googlebot/2.1)'));
  assert.ok(V.isBot('Mozilla/5.0 HeadlessChrome/120'));
  assert.ok(V.isBot(''));
  assert.ok(!V.isBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130'));
});

t('the day and hour are Greek time', () => {
  // 21:30 UTC on 1 October 2026 is 00:30 on the 2nd in Athens (UTC+3)
  assert.deepStrictEqual(V.athens(new Date('2026-10-01T21:30:00Z')), { day: '2026-10-02', hour: '00' });
  // in winter Athens is UTC+2
  assert.deepStrictEqual(V.athens(new Date('2026-12-01T07:05:00Z')), { day: '2026-12-01', hour: '09' });
});

t('what one page view adds: every view a page, the first one of a visit the rest', () => {
  const now = new Date('2026-10-01T07:00:00Z');
  const ctx = { now, ua: 'Mozilla/5.0 (iPhone)', known: KNOWN, ownHosts: ['semfealumni.gr'] };
  const later = V.visitPatch({ path: '/blog/', first: false, ref: '' }, ctx, 'INC');
  assert.strictEqual(later.day, '2026-10-01');
  assert.deepStrictEqual(Object.keys(later.patch).sort(), ['day', 'pages', 'pv', 't']);
  assert.deepStrictEqual(later.patch.pages, { '/blog/': 'INC' });

  const uni = V.visitPatch({ path: '/', first: true, ref: 'www.google.com' },
    Object.assign({}, ctx, { place: { kind: 'university', name: 'Εθνικό Μετσόβιο Πολυτεχνείο' }, v6: true }), 'INC').patch;
  assert.strictEqual(uni.seen, 'INC');
  assert.deepStrictEqual(uni.hours, { 10: 'INC' });
  assert.deepStrictEqual(uni.dev, { mobile: 'INC' });
  assert.deepStrictEqual(uni.ch, { search: 'INC' });
  assert.deepStrictEqual(uni.unis, { 'Εθνικό Μετσόβιο Πολυτεχνείο': 'INC' });
  assert.strictEqual(uni.placed, 'INC');
  assert.strictEqual(uni.v6, 'INC');
  assert.ok(!('cos' in uni));

  const co = V.visitPatch({ path: '/', first: true, ref: '' }, Object.assign({}, ctx, { place: { kind: 'company', name: 'Example Ltd.' } }), 'INC').patch;
  assert.deepStrictEqual(co.cos, { 'Example Ltd.': 'INC' }, 'a name with a full stop is one key, not a path');
  const nobody = V.visitPatch({ path: '/', first: true, ref: '' }, Object.assign({}, ctx, { place: null }), 'INC').patch;
  assert.ok(!('placed' in nobody) && !('unis' in nobody) && !('cos' in nobody));
  // nothing that could identify the visitor is in the update
  const all = JSON.stringify([later, uni, co, nobody]);
  assert.ok(!/iPhone|google\.com|\d+\.\d+\.\d+\.\d+/.test(all), 'no user agent, referrer host or address is stored');
});

/* ---------------------------------------------------------- member-stats */
function person(o) {
  return Object.assign({ status: 'active', stage: 'graduate', direction: '', entryYear: null, gradYear: null,
    gender: '', industry: '', country: '', city: '', employer: '', createdAt: new Date('2026-09-15T10:00:00Z') }, o);
}

t('a category with fewer than 3 people is merged, a question with fewer than 5 answers is not shown', () => {
  const r = S.tally(['a', 'a', 'a', 'b', 'b', 'c', '', null]);
  assert.strictEqual(r.answered, 6);
  assert.deepStrictEqual(r.items, [{ k: 'a', name: 'a', n: 3 }, { k: '_other', name: '', n: 3 }]);
  assert.deepStrictEqual(S.tally(['a', 'a', 'a', 'a']), { answered: 4, items: null });
  const top = S.tally(['a', 'a', 'a', 'b', 'b', 'b', 'c', 'c', 'c'], { top: 2 });
  assert.deepStrictEqual(top.items.map(x => x.k), ['a', 'b', '_other']);
  assert.strictEqual(top.items[2].n, 3);
});

t('the members\' statistics are anonymous and count what they say', () => {
  const people = [];
  for (let i = 0; i < 6; i++) people.push(person({ gender: 'female', industry: 'software', entryYear: 2005, gradYear: 2010, city: 'Αθήνα', country: 'GR', employer: 'Example S.A.', direction: 'Εφαρμοσμένα Μαθηματικά' }));
  for (let i = 0; i < 4; i++) people.push(person({ gender: 'male', industry: 'finance', entryYear: 2011, gradYear: 2017, city: 'London, UK', employer: 'EXAMPLE SA', status: 'pending', createdAt: new Date('2026-10-01T09:00:00Z') }));
  people.push(person({ gender: 'other', industry: 'energy', entryYear: 1990, gradYear: 1995, city: 'Ζυρίχη', country: 'CH', employer: 'Tiny Firm' }));
  people.push(person({ gender: 'na', industry: '', status: 'active', stage: 'faculty' }));
  people.push(person({ gender: 'female', status: 'rejected' }));          // not counted at all
  const s = S.memberStats(people, new Date('2026-10-01T12:00:00Z'));
  assert.strictEqual(s.registered, 12);
  assert.strictEqual(s.active, 8);
  assert.deepStrictEqual(s.dims.gender.items, [{ k: 'female', name: 'female', n: 6 }, { k: 'male', name: 'male', n: 4 }, { k: '_other', name: '', n: 1 }]);
  assert.strictEqual(s.dims.gender.answered, 11, '"prefer not to say" is not an answer');
  assert.deepStrictEqual(s.dims.industry.items.map(x => [x.k, x.n]), [['software', 6], ['finance', 4], ['_other', 1]]);
  assert.deepStrictEqual(s.dims.country.items.map(x => [x.k, x.n]), [['GR', 6], ['GB', 4], ['_other', 1]], 'the country of "London, UK" is read from the old one-box answer');
  assert.deepStrictEqual(s.dims.city.items.map(x => [x.name, x.n]), [['Αθήνα', 6], ['Λονδίνο', 4], ['', 1]]);
  assert.deepStrictEqual(s.dims.entry.items.map(x => [x.k, x.n]), [['2005–2009', 6], ['2010–2014', 4], ['_other', 1]]);
  assert.deepStrictEqual(s.dims.study.items.map(x => [x.k, x.n]), [['05', 7], ['06', 4]], 'five years of study, whatever the decade');
  assert.deepStrictEqual(s.dims.employer.items.map(x => [x.k, x.n]), [['example', 10], ['_other', 1]], 'one employer, two spellings; a single person\'s employer is not named');
  assert.deepStrictEqual(s.dims.direction.items.map(x => [x.name, x.n]), [['Εφαρμοσμένα Μαθηματικά', 6]]);
  assert.strictEqual(s.dims.stage.items.length, 2, 'graduate (11) and the one faculty member merged');
});

t('the published document holds no name, e-mail or per-person row', () => {
  const people = Array.from({ length: 8 }, (_, i) => person({ firstName: 'Name' + i, lastName: 'Surname' + i, email: 'p' + i + '@example.gr', phone: '69' + i, employer: 'Company ' + i, city: 'Town' + i }));
  const json = JSON.stringify(S.memberStats(people, new Date()));
  assert.ok(!/Name\d|Surname|@example|69\d/.test(json));
  assert.ok(!/Company \d|Town\d/.test(json), 'single-person employers and cities are not named');
});

t('registrations are counted per month', () => {
  const s = S.memberStats([person({ createdAt: { seconds: Date.UTC(2026, 8, 30) / 1000 } }), person({ createdAt: { _seconds: Date.UTC(2026, 9, 1) / 1000 } }),
    person({ createdAt: { toDate: () => new Date('2026-10-02T00:00:00Z') } }), person({ createdAt: null })], new Date());
  assert.deepStrictEqual(s.growth, [['2026-09', 1], ['2026-10', 2]]);
});

t('only a change that moves the statistics recounts them', () => {
  const a = person({ industry: 'software' });
  assert.ok(S.matters(null, a) && S.matters(a, null), 'created or deleted');
  assert.ok(!S.matters(a, Object.assign({}, a, { linkedin: 'https://linkedin.com/in/x', updatedAt: 1 })));
  assert.ok(S.matters(a, Object.assign({}, a, { industry: 'finance' })));
  assert.ok(S.matters(a, Object.assign({}, a, { status: 'rejected' })));
});

t('functions/profile-options.js is the same file as assets/js/profile-options.js', () => {
  const a = fs.readFileSync(path.join(__dirname, 'profile-options.js'), 'utf8');
  const b = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'profile-options.js'), 'utf8');
  assert.strictEqual(a, b, 'copy assets/js/profile-options.js over functions/profile-options.js');
});

t('the page list the visit counter needs exists and is the generated one', () => {
  const p = JSON.parse(fs.readFileSync(path.join(__dirname, 'site-paths.json'), 'utf8'));
  assert.ok(Array.isArray(p.paths) && p.paths.includes('/') && p.paths.includes('/analytics/'));
  assert.ok(!p.paths.includes('/admin/') && !p.paths.includes('/auth/linkedin/'), 'the admin and sign-in pages are not counted');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
