/* SEMFE Alumni: which university or company a visitor's NETWORK belongs to.

   The «Στατιστικά» page lists the universities and the companies people visit
   the site from. Google Analytics cannot say this (it dropped the "network
   domain" report years ago, and a browser cannot look up its own network),
   but a server can: the recordVisit Cloud Function receives the connection,
   so it knows the address it came from, and every address has two public
   records:
     - its reverse-DNS name, when the network publishes one
       ("gw.central.ntua.gr" is NTUA's);
     - its REGISTRATION at the regional internet registry, read over RDAP
       (the successor to WHOIS): who the address block is registered to.
   This file is the pure part: it reads those two answers and decides what to
   count. The same approach operationsacademia.org uses (its netorg.js), with
   companies added at the owner's request (2026-10-01).

   WHAT IS COUNTED, AND WHAT NEVER IS
     { kind: 'university', name }   a university or research centre
     { kind: 'academic' }           an academic network we cannot name
                                    (a national research network, say)
     { kind: 'company', name }      an organisation that registers its OWN
                                    network: a company, a bank, a ministry
     null                           everything else: internet providers,
                                    mobile operators, hosting and cloud
                                    companies, VPNs and security proxies.
   Home and mobile connections are registered to the provider, so they land
   in the last group and nothing about them is kept. A provider's name would
   tell us nothing, and a company is named only when the network is
   registered to the company itself.

   THE ADDRESS IS NEVER STORED OR LOGGED. It is read, looked up and
   forgotten inside the request; only the name of the organisation reaches
   Firestore, as a counter per day (functions/index.js, recordVisit).

   Precision before coverage: when in doubt the answer is null. A company
   list that names an internet provider, or a university list that names a
   company, would be read as fact. */
'use strict';

/* Academic suffixes under which the university is ONE label up:
   ox.ac.uk is the university, ac.uk the suffix. */
const ACADEMIC_SUFFIXES = [
  'ac.uk', 'ac.at', 'ac.be', 'ac.cn', 'ac.cy', 'ac.il', 'ac.in', 'ac.jp', 'ac.kr',
  'ac.nz', 'ac.rs', 'ac.th', 'ac.za', 'ac.ae',
  'edu.ar', 'edu.au', 'edu.br', 'edu.cn', 'edu.co', 'edu.eg', 'edu.gr', 'edu.hk',
  'edu.in', 'edu.lb', 'edu.mx', 'edu.my', 'edu.pl', 'edu.qa', 'edu.sa', 'edu.sg',
  'edu.tr', 'edu.tw'
];
/* Second-level domains that are COUNTRY suffixes, not organisations, so the
   organisation is one label further up (example.co.uk, example.com.cy). */
const PUBLIC_SUFFIXES = [
  'co.uk', 'org.uk', 'gov.uk', 'com.cy', 'org.cy', 'gov.cy', 'com.au', 'net.au', 'org.au',
  'co.jp', 'co.kr', 'com.br', 'com.cn', 'com.tr', 'gov.tr', 'co.in', 'co.il', 'co.nz',
  'co.za', 'com.sg', 'com.hk', 'com.mx', 'com.ar', 'com.gr', 'gov.gr', 'org.gr', 'net.gr'
];

/* Greek universities and research centres, by their domain, with the name
   the page shows. A university abroad is named from its registration (which
   names it in full) or, failing that, shown by its domain. */
const KNOWN = {
  'ntua.gr': 'Εθνικό Μετσόβιο Πολυτεχνείο',
  'uoa.gr': 'Εθνικό και Καποδιστριακό Πανεπιστήμιο Αθηνών',
  'auth.gr': 'Αριστοτέλειο Πανεπιστήμιο Θεσσαλονίκης',
  'upatras.gr': 'Πανεπιστήμιο Πατρών',
  'uoc.gr': 'Πανεπιστήμιο Κρήτης',
  'tuc.gr': 'Πολυτεχνείο Κρήτης',
  'uoi.gr': 'Πανεπιστήμιο Ιωαννίνων',
  'duth.gr': 'Δημοκρίτειο Πανεπιστήμιο Θράκης',
  'uth.gr': 'Πανεπιστήμιο Θεσσαλίας',
  'aueb.gr': 'Οικονομικό Πανεπιστήμιο Αθηνών',
  'unipi.gr': 'Πανεπιστήμιο Πειραιώς',
  'uom.gr': 'Πανεπιστήμιο Μακεδονίας',
  'aegean.gr': 'Πανεπιστήμιο Αιγαίου',
  'ionio.gr': 'Ιόνιο Πανεπιστήμιο',
  'hua.gr': 'Χαροκόπειο Πανεπιστήμιο',
  'panteion.gr': 'Πάντειο Πανεπιστήμιο',
  'eap.gr': 'Ελληνικό Ανοικτό Πανεπιστήμιο',
  'ihu.gr': 'Διεθνές Πανεπιστήμιο της Ελλάδος',
  'uniwa.gr': 'Πανεπιστήμιο Δυτικής Αττικής',
  'uop.gr': 'Πανεπιστήμιο Πελοποννήσου',
  'uowm.gr': 'Πανεπιστήμιο Δυτικής Μακεδονίας',
  'hmu.gr': 'Ελληνικό Μεσογειακό Πανεπιστήμιο',
  'aua.gr': 'Γεωπονικό Πανεπιστήμιο Αθηνών',
  'asfa.gr': 'Ανωτάτη Σχολή Καλών Τεχνών',
  'hna.gr': 'Σχολή Ναυτικών Δοκίμων',
  'sse.gr': 'Στρατιωτική Σχολή Ευελπίδων',
  'hafa.haf.gr': 'Σχολή Ικάρων',
  'demokritos.gr': 'ΕΚΕΦΕ «Δημόκριτος»',
  'forth.gr': 'Ίδρυμα Τεχνολογίας και Έρευνας (ΙΤΕ)',
  'certh.gr': 'Εθνικό Κέντρο Έρευνας και Τεχνολογικής Ανάπτυξης (ΕΚΕΤΑ)',
  'athenarc.gr': 'Ερευνητικό Κέντρο «Αθηνά»',
  'eie.gr': 'Εθνικό Ίδρυμα Ερευνών',
  'noa.gr': 'Εθνικό Αστεροσκοπείο Αθηνών',
  'academyofathens.gr': 'Ακαδημία Αθηνών',
  'bioacademy.gr': 'Ίδρυμα Ιατροβιολογικών Ερευνών Ακαδημίας Αθηνών',
  'fleming.gr': 'Ερευνητικό Κέντρο «Αλέξανδρος Φλέμινγκ»',
  'hcmr.gr': 'Ελληνικό Κέντρο Θαλάσσιων Ερευνών',
  'ucy.ac.cy': 'Πανεπιστήμιο Κύπρου',
  'cut.ac.cy': 'Τεχνολογικό Πανεπιστήμιο Κύπρου',
  'cern.ch': 'CERN',
  'ethz.ch': 'ETH Zurich',
  'epfl.ch': 'EPFL',
  'mit.edu': 'Massachusetts Institute of Technology',
  'cam.ac.uk': 'University of Cambridge',
  'ox.ac.uk': 'University of Oxford',
  'imperial.ac.uk': 'Imperial College London',
  'ucl.ac.uk': 'University College London',
  'tum.de': 'Technische Universität München',
  'tudelft.nl': 'TU Delft',
  'kth.se': 'KTH Royal Institute of Technology'
};

/* National research and education networks: academic, but they carry many
   institutions, so the visit is academic and attributed to nobody. */
const RESEARCH_NETWORKS = /\b(grnet|εδυτε|geant|janet|jisc|dfn|renater|surf ?net|surf|switch|garr|rediris|internet2|esnet|canarie|aarnet|nordunet|cynet|belnet|aconet|cesnet|funet|sunet|uninett|heanet|pionier|restena|arnes|carnet)\b/;

/* Names that make a registrant academic (folded: lower case, no accents). */
const ACADEMIC_NAME = /\b(university|universitat|universitaet|universite|universita|universidad|universidade|universiteit|uniwersytet|univerzita|univ|πανεπιστημιο|πολυτεχνειο|polytechnic|politecnico|polytechnique|institute of technology|technische hochschule|hochschule|technion|college|ecole|research (centre|center|institute|council)|academy of sciences|max planck|fraunhofer|inria|cnrs|cern|ερευνητικο κεντρο|ινστιτουτο|ιδρυμα τεχνολογιας)\b/;

/* NEVER counted as a company: internet and mobile providers, hosting, cloud
   and content-delivery companies, VPNs and the security proxies companies
   route their staff through (Zscaler and the like: counting those would
   credit the proxy, not the company behind it). Matched against the folded
   registrant name and the contact domains. Precision, not completeness: an
   organisation that slips through is one wrong row, and is fixed by adding
   it here. */
const PROVIDER_NAME = new RegExp('\\b(' + [
  'telecom\\w*', 'telekom\\w*', 'telecommunication\\w*', 'telefonica', 'telco', 'broadband', 'cable\\w*',
  'communications?', 'mobile', 'wireless', 'cellular', 'internet', 'isp', 'online', 'hosting', 'host',
  'datacenters?', 'data ?centers?', 'data ?centres?', 'cloud\\w*', 'vps', 'servers?', 'colocation',
  'networks?', 'fib(er|re)', 'dsl', 'ftth', 'satellite', 'vpn', 'proxy', 'transit', 'backbone',
  'ote', 'cosmote', 'vodafone', 'wind', 'nova', 'forthnet', 'hol', 'hellas online', 'cyta', 'inalan',
  'vivodi', 'orange', 'comcast', 'charter', 'spectrum', 'verizon', 'at ?t', 't mobile', 'sky', 'virgin media',
  'liberty global', 'ziggo', 'kpn', 'proximus', 'swisscom', 'telia', 'telenor', 'free sas', 'sfr', 'bouygues',
  'iliad', 'tele2', 'tim', 'fastweb', 'telstra', 'optus', 'rogers', 'bell canada', 'shaw', 'telus', 'cox',
  'frontier', 'centurylink', 'lumen', 'level ?3', 'cogent', 'zayo', 'hurricane electric', 'gtt', 'colt',
  'akamai', 'cloudflare', 'fastly', 'amazon', 'aws', 'google', 'microsoft', 'azure', 'oracle', 'alibaba',
  'tencent', 'huawei', 'ovh', 'hetzner', 'digitalocean', 'digital ocean', 'linode', 'vultr', 'leaseweb',
  'contabo', 'scaleway', 'm247', 'datacamp', 'choopa', 'hostinger', 'godaddy', 'ionos', 'strato', 'aruba',
  'rackspace', 'equinix', 'zscaler', 'netskope', 'opendns', 'cisco umbrella', 'prisma', 'palo alto',
  'forcepoint', 'menlo security', 'iboss', 'mullvad', 'nordvpn', 'expressvpn', 'proton', 'private internet',
  'apple', 'meta platforms', 'facebook', 'china mobile', 'china unicom', 'china telecom', 'reliance jio',
  'airtel', 'starlink', 'spacex'
].join('|') + ')\\b');
const PROVIDER_DOMAINS = [
  'otenet.gr', 'ote.gr', 'cosmote.gr', 'vodafone.gr', 'vodafone.com', 'wind.gr', 'nova.gr', 'forthnet.gr',
  'hol.gr', 'cyta.gr', 'cyta.com.cy', 'inalan.gr', 'grnet.gr', 'comcast.net', 'verizon.net', 'rr.com',
  'charter.com', 'att.net', 'sbcglobal.net', 'cox.net', 'btcentralplus.com', 'bt.com', 'sky.com',
  'virginmedia.com', 'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.net', 'telekom.de', 't-ipconnect.de',
  'amazonaws.com', 'amazon.com', 'googleusercontent.com', 'google.com', '1e100.net', 'microsoft.com',
  'azure.com', 'cloudflare.com', 'akamai.com', 'akamaitechnologies.com', 'fastly.com', 'ovh.net', 'ovh.com',
  'hetzner.com', 'hetzner.de', 'your-server.de', 'digitalocean.com', 'linode.com', 'leaseweb.com',
  'contabo.com', 'zscaler.com', 'zscaler.net', 'apple.com', 'icloud.com',
  // the registries themselves and free mailboxes name nobody
  'ripe.net', 'arin.net', 'apnic.net', 'lacnic.net', 'afrinic.net', 'gmail.com', 'googlemail.com',
  'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'aol.com', 'mail.ru', 'yandex.ru'
];
const GENERIC_DOMAINS = ['ripe.net', 'arin.net', 'apnic.net', 'lacnic.net', 'afrinic.net', 'gmail.com',
  'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'aol.com', 'mail.ru',
  'yandex.ru', 'protonmail.com', 'proton.me'];

/** Lower case, no accents, punctuation to spaces. */
function fold(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/ς/g, 'σ')
    .replace(/&/g, ' and ').replace(/[^a-z0-9α-ω]+/g, ' ').trim();
}

/** The registrable domain: www.central.ntua.gr -> ntua.gr,
    it.ox.ac.uk -> ox.ac.uk, mail.example.co.uk -> example.co.uk. */
function registrableDomain(host) {
  let h = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  if (!h || !/^[a-z0-9.-]+$/.test(h) || /^[\d.]+$/.test(h)) return '';
  const parts = h.split('.').filter(Boolean);
  if (parts.length < 2) return '';
  for (const s of ACADEMIC_SUFFIXES.concat(PUBLIC_SUFFIXES)) {
    if (h === s) return '';
    if (h.endsWith('.' + s)) {
      const n = s.split('.').length + 1;
      return parts.length < n ? '' : parts.slice(-n).join('.');
    }
  }
  // a few multi-label names the KNOWN table holds (hafa.haf.gr)
  const three = parts.slice(-3).join('.');
  if (parts.length >= 3 && Object.prototype.hasOwnProperty.call(KNOWN, three)) return three;
  return parts.slice(-2).join('.');
}

function isProviderDomain(d) { return !!d && PROVIDER_DOMAINS.indexOf(d) !== -1; }
function knownName(d) { return d && Object.prototype.hasOwnProperty.call(KNOWN, d) ? KNOWN[d] : ''; }
function academicDomain(d) {
  if (!d) return false;
  if (knownName(d)) return true;
  const tld = d.split('.').slice(-1)[0];
  if (tld === 'edu' || tld === 'ac') return true;
  return ACADEMIC_SUFFIXES.some(s => d.endsWith('.' + s));
}

/** An organisation's name as the page shows it: spaces tidied, and an
    ALL-CAPITALS registration ("NATIONAL TECHNICAL UNIVERSITY OF ATHENS")
    written in ordinary case. */
const SMALL = ['of', 'and', 'the', 'for', 'de', 'la', 'le', 'des', 'du', 'di', 'del', 'und', 'fur', 'für', 'van', 'von', 'y', 'e', 'et', 'at', 'in'];
const KEEP_UPPER = ['sa', 'ag', 'ae', 'bv', 'nv', 'ab', 'as', 'plc', 'llc', 'spa', 'srl', 'ike', 'oe', 'ee', 'eu', 'uk', 'usa', 'it', 'ict', 'r&d', 'cern', 'ibm', 'sap', 'kpmg', 'pwc', 'ey', 'bnp', 'ing', 'hsbc', 'ubs', 'abb', 'nasa', 'esa', 'eib', 'ecb'];
function tidyName(s) {
  let t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim().replace(/[\s,;:-]+$/, '');
  if (!t) return '';
  if (/[A-ZΑ-Ω]/.test(t) && t === t.toUpperCase()) {
    t = t.toLowerCase().split(' ').map((w, i) => {
      const bare = w.replace(/[.,()]/g, '');
      if (KEEP_UPPER.indexOf(bare) !== -1) return w.toUpperCase();
      if (i > 0 && SMALL.indexOf(bare) !== -1) return w;
      if (bare === 'gmbh') return w.replace('gmbh', 'GmbH');
      if (bare === 'ltd' || bare === 'inc') return w.charAt(0).toUpperCase() + w.slice(1);
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }
  return t.slice(0, 120);
}

/* -------------------------------------------------- the reverse-DNS name */

/** What a reverse-DNS name says: a university, an academic network, or
    nothing. A company is NEVER named from reverse DNS: a business line's
    name is usually the provider's ("x.static.otenet.gr"), and one that is
    not cannot be told apart from a hosting server, so only the registration
    (below) may name a company. */
function classifyHost(host) {
  const d = registrableDomain(host);
  if (!d) return null;
  const known = knownName(d);
  if (known) return { kind: 'university', name: known, domain: d };
  if (RESEARCH_NETWORKS.test(fold(d.split('.')[0]))) return { kind: 'academic' };
  if (academicDomain(d)) return { kind: 'university', name: d, domain: d, fromDomain: true };
  return null;
}

/* ---------------------------------------------- the network's registration */

/** What an RDAP answer carries that can name an organisation: the domains of
    the contact addresses, the registrant's name, and the network's own name.
    Bounded walk: the answer comes from outside and is read inside a request. */
function registrationFacts(rdap) {
  const domains = [], names = [];
  let visited = 0;
  function card(en) {
    const vc = en && Array.isArray(en.vcardArray) && Array.isArray(en.vcardArray[1]) ? en.vcardArray[1] : [];
    const roles = Array.isArray(en && en.roles) ? en.roles : [];
    for (const prop of vc) {
      if (!Array.isArray(prop)) continue;
      const value = String(prop[3] == null ? '' : prop[3]);
      if (prop[0] === 'email') {
        const m = /@([a-z0-9.-]+)\s*$/i.exec(value);
        const d = m ? registrableDomain(m[1]) : '';
        if (d && domains.indexOf(d) === -1) domains.push(d);
      } else if (prop[0] === 'fn' && roles.indexOf('registrant') !== -1) {
        const n = value.trim().slice(0, 200);
        if (n && names.indexOf(n) === -1) names.push(n);
      }
    }
  }
  (function walk(node, depth) {
    if (!node || typeof node !== 'object' || depth > 4) return;
    for (const en of Array.isArray(node.entities) ? node.entities : []) {
      if (++visited > 200) return;
      card(en);
      walk(en, depth + 1);
    }
  })(rdap, 0);
  const netName = rdap && typeof rdap.name === 'string' ? rdap.name.slice(0, 100) : '';
  return { domains, names, netName };
}

/**
 * What a network's REGISTRATION says should be counted: a university, an
 * academic network, a company, or null. `rdap` is the registry's JSON
 * answer, or null when the look-up failed.
 */
function classifyRegistration(rdap) {
  if (!rdap || typeof rdap !== 'object') return null;
  const f = registrationFacts(rdap);
  const folded = f.names.map(fold);
  const own = f.domains.filter(d => GENERIC_DOMAINS.indexOf(d) === -1);

  // 1. a university or research centre we know by its domain
  for (const d of own) {
    const k = knownName(d);
    if (k) return { kind: 'university', name: k, domain: d };
  }
  // 2. a national research network: academic, attributed to nobody
  if (folded.some(n => RESEARCH_NETWORKS.test(n)) || RESEARCH_NETWORKS.test(fold(f.netName)) ||
      own.some(d => RESEARCH_NETWORKS.test(fold(d.split('.')[0])))) return { kind: 'academic' };
  // 3. a university by its name or its academic contact domain
  const uniName = f.names.find(n => ACADEMIC_NAME.test(fold(n)));
  const uniDomain = own.find(academicDomain);
  if (uniName) return { kind: 'university', name: tidyName(uniName), domain: uniDomain || '' };
  if (uniDomain) return { kind: 'university', name: uniDomain, domain: uniDomain, fromDomain: true };
  // 4. a provider anywhere in the registration: nothing is counted
  if (folded.some(n => PROVIDER_NAME.test(n))) return null;
  if (own.some(isProviderDomain) || own.some(d => PROVIDER_NAME.test(fold(d.split('.')[0])))) return null;
  // 5. an organisation that registers its own network
  if (f.names.length === 1) return { kind: 'company', name: tidyName(f.names[0]) };
  if (f.names.length > 1) return null;          // two registrants: we cannot say which
  return null;
}

/**
 * The answer for one visit, from both records: the curated university name
 * from reverse DNS first; otherwise the registration (which names a
 * university abroad in full, and is the only thing that may name a company);
 * otherwise an academic domain seen in reverse DNS, shown by its domain.
 */
function place(host, rdap) {
  const byHost = classifyHost(host);
  if (byHost && byHost.kind === 'university' && !byHost.fromDomain) return byHost;
  const byReg = classifyRegistration(rdap);
  if (byReg && byReg.kind === 'university') {
    // a registration naming a university by its domain only, beside a
    // reverse-DNS name: either is as good; keep the registration
    return byReg;
  }
  if (byHost) return byHost;
  return byReg;
}

/* ------------------------------------------------ the visitor's address */

/** One entry of an X-Forwarded-For list, any port removed. */
function bareIp(entry) {
  let v = String(entry || '').trim();
  if (!v) return '';
  if (v.charAt(0) === '[') {
    const end = v.indexOf(']');
    return end > 0 ? v.slice(1, end).toLowerCase() : '';
  }
  if ((v.match(/:/g) || []).length === 1) v = v.split(':')[0];
  return v.toLowerCase();
}

/** A routable address: the only kind worth looking up. */
function isPublicIp(ip) {
  const v = String(ip || '').trim().toLowerCase();
  if (!v) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) {
    const p = v.split('.').map(Number);
    if (p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return false;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
    if (p[0] === 192 && p[1] === 168) return false;
    if (p[0] === 169 && p[1] === 254) return false;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return false;
    if (p[0] >= 224) return false;
    return true;
  }
  if (v.indexOf(':') !== -1 && /^[0-9a-f:.]+$/.test(v)) {
    const mapped = v.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return isPublicIp(mapped[1]);
    if (v === '::' || v === '::1') return false;
    if (/^f[cd]/.test(v) || /^fe[89ab]/.test(v)) return false;
    return true;
  }
  return false;
}

/**
 * The visitor's address from X-Forwarded-For: the LAST routable entry,
 * because Google's front end APPENDS the address it saw to whatever the
 * client sent, so the left-hand entries are whatever a visitor chose to write.
 */
function clientIp(forwardedFor) {
  const parts = String(forwardedFor || '').split(',');
  for (let i = parts.length - 1; i >= 0; i--) {
    const ip = bareIp(parts[i]);
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
    if (isPublicIp(ip)) return mapped ? mapped[1] : ip;
  }
  return '';
}

/** The network an address belongs to, for the in-memory cache: the /24 of
    an IPv4 address, the /48 of an IPv6 one. Never stored anywhere. */
function networkOf(ip) {
  const v = String(ip || '');
  if (v.indexOf(':') === -1) return v.split('.').slice(0, 3).join('.');
  const full = v.split('::');
  const head = full[0].split(':').filter(Boolean);
  while (head.length < 3) head.push('0');
  return head.slice(0, 3).join(':');
}

module.exports = {
  KNOWN, ACADEMIC_SUFFIXES, PUBLIC_SUFFIXES,
  fold, registrableDomain, academicDomain, isProviderDomain, tidyName,
  classifyHost, registrationFacts, classifyRegistration, place,
  bareIp, isPublicIp, clientIp, networkOf
};
