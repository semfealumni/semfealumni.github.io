/* SEMFE Alumni: the fixed answers of the profile form (gender, industry,
   country), and the helpers that tidy the free-text answers (city, employer)
   before they are counted.

   ONE definition, used in three places, so they cannot disagree:
     - the form on account/ draws its drop-downs from these lists, and the
       member pages show the labels (<script src="assets/js/profile-options.js">
       -> window.SEMFE_PROFILE);
     - the Cloud Function and the daily workflow that count the members for
       the «Στατιστικά» page (functions/member-stats.js -> require);
     - firestore.rules lists the same gender and industry keys
       (tools/check.mjs fails when they differ).
   functions/profile-options.js is a byte-for-byte COPY of this file, because
   a Cloud Function deploy ships only the functions/ folder. Edit this one and
   copy it over: tools/check.mjs fails when the two differ.

   Every key is stored, never a label, so a label can be reworded without
   touching anyone's data. Written in ES5 for every browser the site supports. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SEMFE_PROFILE = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* [key, Greek label, English label]: the English copy of the site
     (en/) shows the third. 'na' = "I prefer not to say": a real answer,
     never counted as one */
  var GENDERS = [
    ['female', 'Γυναίκα', 'Woman'],
    ['male', 'Άνδρας', 'Man'],
    ['other', 'Άλλο', 'Other'],
    ['na', 'Δεν επιθυμώ να απαντήσω', 'I prefer not to say']
  ];

  var INDUSTRIES = [
    ['academia', 'Πανεπιστήμιο & Έρευνα', 'University & research'],
    ['education', 'Εκπαίδευση', 'Education'],
    ['studies', 'Μεταπτυχιακές / διδακτορικές σπουδές', 'Postgraduate / doctoral studies'],
    ['software', 'Πληροφορική & Λογισμικό', 'IT & software'],
    ['data', 'Δεδομένα & Τεχνητή Νοημοσύνη', 'Data & artificial intelligence'],
    ['telecom', 'Τηλεπικοινωνίες', 'Telecommunications'],
    ['finance', 'Τράπεζες & Χρηματοοικονομικά', 'Banking & finance'],
    ['insurance', 'Ασφάλειες & Αναλογιστική', 'Insurance & actuarial science'],
    ['consulting', 'Συμβουλευτικές υπηρεσίες', 'Consulting'],
    ['energy', 'Ενέργεια', 'Energy'],
    ['manufacturing', 'Βιομηχανία & Παραγωγή', 'Industry & manufacturing'],
    ['engineering', 'Τεχνικά έργα & Κατασκευές', 'Engineering works & construction'],
    ['health', 'Υγεία & Ιατρική Φυσική', 'Health & medical physics'],
    ['pharma', 'Φαρμακευτική & Βιοτεχνολογία', 'Pharmaceuticals & biotechnology'],
    ['defence', 'Άμυνα & Αεροδιαστημική', 'Defence & aerospace'],
    ['transport', 'Μεταφορές & Εφοδιαστική', 'Transport & logistics'],
    ['public', 'Δημόσιος τομέας', 'Public sector'],
    ['commerce', 'Εμπόριο & Υπηρεσίες', 'Trade & services'],
    ['media', 'Μέσα ενημέρωσης & Επικοινωνία', 'Media & communication'],
    ['other', 'Άλλο', 'Other']
  ];

  /* ISO 3166 code, Greek name, the other ways people write it (phrases
     separated by |, folded: lower case, no accents), English name. 'XX' is
     "another country". Greece first, then the Greek names alphabetically
     (the Greek form shows them in this order; the English one sorts by the
     English name, see choices()). */
  var COUNTRIES = [
    ['GR', 'Ελλάδα', 'greece|hellas|ellada|ellas|ελλας|hellenic republic', 'Greece'],
    ['AL', 'Αλβανία', 'albania', 'Albania'],
    ['AR', 'Αργεντινή', 'argentina', 'Argentina'],
    ['AU', 'Αυστραλία', 'australia', 'Australia'],
    ['AT', 'Αυστρία', 'austria|osterreich', 'Austria'],
    ['BE', 'Βέλγιο', 'belgium|belgique|belgie', 'Belgium'],
    ['MK', 'Βόρεια Μακεδονία', 'north macedonia|fyrom', 'North Macedonia'],
    ['BG', 'Βουλγαρία', 'bulgaria', 'Bulgaria'],
    ['BR', 'Βραζιλία', 'brazil|brasil', 'Brazil'],
    ['FR', 'Γαλλία', 'france', 'France'],
    ['DE', 'Γερμανία', 'germany|deutschland', 'Germany'],
    ['DK', 'Δανία', 'denmark|danmark', 'Denmark'],
    ['EE', 'Εσθονία', 'estonia', 'Estonia'],
    ['CH', 'Ελβετία', 'switzerland|schweiz|suisse|svizzera', 'Switzerland'],
    ['AE', 'Ηνωμένα Αραβικά Εμιράτα', 'united arab emirates|uae|dubai|abu dhabi|εμιρατα', 'United Arab Emirates'],
    ['GB', 'Ηνωμένο Βασίλειο', 'united kingdom|uk|u k|great britain|britain|england|scotland|wales|αγγλια|βρετανια|μεγαλη βρετανια', 'United Kingdom'],
    ['US', 'ΗΠΑ', 'united states|usa|u s a|us|u s|america|united states of america|ηνωμενες πολιτειες|αμερικη', 'United States'],
    ['JP', 'Ιαπωνία', 'japan', 'Japan'],
    ['IN', 'Ινδία', 'india', 'India'],
    ['IE', 'Ιρλανδία', 'ireland|eire', 'Ireland'],
    ['IS', 'Ισλανδία', 'iceland', 'Iceland'],
    ['ES', 'Ισπανία', 'spain|espana', 'Spain'],
    ['IL', 'Ισραήλ', 'israel', 'Israel'],
    ['IT', 'Ιταλία', 'italy|italia', 'Italy'],
    ['CA', 'Καναδάς', 'canada', 'Canada'],
    ['QA', 'Κατάρ', 'qatar', 'Qatar'],
    ['CN', 'Κίνα', 'china', 'China'],
    ['CY', 'Κύπρος', 'cyprus|kypros', 'Cyprus'],
    ['HR', 'Κροατία', 'croatia|hrvatska', 'Croatia'],
    ['LV', 'Λετονία', 'latvia', 'Latvia'],
    ['LT', 'Λιθουανία', 'lithuania', 'Lithuania'],
    ['LU', 'Λουξεμβούργο', 'luxembourg', 'Luxembourg'],
    ['MT', 'Μάλτα', 'malta', 'Malta'],
    ['MX', 'Μεξικό', 'mexico', 'Mexico'],
    ['NO', 'Νορβηγία', 'norway|norge', 'Norway'],
    ['KR', 'Νότια Κορέα', 'south korea|korea', 'South Korea'],
    ['ZA', 'Νότια Αφρική', 'south africa', 'South Africa'],
    ['NZ', 'Νέα Ζηλανδία', 'new zealand', 'New Zealand'],
    ['NL', 'Ολλανδία', 'netherlands|the netherlands|holland|nederland|κατω χωρες', 'Netherlands'],
    ['HU', 'Ουγγαρία', 'hungary', 'Hungary'],
    ['PL', 'Πολωνία', 'poland|polska', 'Poland'],
    ['PT', 'Πορτογαλία', 'portugal', 'Portugal'],
    ['RO', 'Ρουμανία', 'romania', 'Romania'],
    ['SA', 'Σαουδική Αραβία', 'saudi arabia', 'Saudi Arabia'],
    ['RS', 'Σερβία', 'serbia', 'Serbia'],
    ['SG', 'Σιγκαπούρη', 'singapore', 'Singapore'],
    ['SK', 'Σλοβακία', 'slovakia', 'Slovakia'],
    ['SI', 'Σλοβενία', 'slovenia', 'Slovenia'],
    ['SE', 'Σουηδία', 'sweden|sverige', 'Sweden'],
    ['TR', 'Τουρκία', 'turkey|turkiye', 'Turkey'],
    ['CZ', 'Τσεχία', 'czechia|czech republic', 'Czechia'],
    ['FI', 'Φινλανδία', 'finland|suomi', 'Finland'],
    ['HK', 'Χονγκ Κονγκ', 'hong kong', 'Hong Kong'],
    ['CL', 'Χιλή', 'chile', 'Chile'],
    ['XX', 'Άλλη χώρα', '', 'Another country']
  ];

  /* Cities people are likely to write in more than one way. The key is the
     folded spelling; the value is how the statistics name it. A city not
     listed here is counted under the spelling most people used. */
  var CITY_ALIASES = {
    'αθηνα': 'Αθήνα', 'athens': 'Αθήνα', 'athina': 'Αθήνα', 'athen': 'Αθήνα', 'αθηναι': 'Αθήνα',
    'θεσσαλονικη': 'Θεσσαλονίκη', 'thessaloniki': 'Θεσσαλονίκη', 'salonica': 'Θεσσαλονίκη', 'thessalonika': 'Θεσσαλονίκη',
    'πατρα': 'Πάτρα', 'patra': 'Πάτρα', 'patras': 'Πάτρα',
    'ηρακλειο': 'Ηράκλειο', 'heraklion': 'Ηράκλειο', 'iraklio': 'Ηράκλειο', 'irakleio': 'Ηράκλειο',
    'λαρισα': 'Λάρισα', 'larisa': 'Λάρισα', 'larissa': 'Λάρισα',
    'βολος': 'Βόλος', 'volos': 'Βόλος',
    'ιωαννινα': 'Ιωάννινα', 'ioannina': 'Ιωάννινα',
    'χανια': 'Χανιά', 'chania': 'Χανιά', 'hania': 'Χανιά',
    'πειραιας': 'Πειραιάς', 'piraeus': 'Πειραιάς', 'peiraias': 'Πειραιάς', 'pireas': 'Πειραιάς',
    'λευκωσια': 'Λευκωσία', 'nicosia': 'Λευκωσία', 'lefkosia': 'Λευκωσία',
    'λεμεσος': 'Λεμεσός', 'limassol': 'Λεμεσός',
    'λονδινο': 'Λονδίνο', 'london': 'Λονδίνο',
    'παρισι': 'Παρίσι', 'paris': 'Παρίσι',
    'βερολινο': 'Βερολίνο', 'berlin': 'Βερολίνο',
    'μοναχο': 'Μόναχο', 'munich': 'Μόναχο', 'munchen': 'Μόναχο', 'muenchen': 'Μόναχο',
    'ζυριχη': 'Ζυρίχη', 'zurich': 'Ζυρίχη', 'zuerich': 'Ζυρίχη',
    'γενευη': 'Γενεύη', 'geneva': 'Γενεύη', 'geneve': 'Γενεύη', 'genf': 'Γενεύη',
    'βρυξελλες': 'Βρυξέλλες', 'brussels': 'Βρυξέλλες', 'bruxelles': 'Βρυξέλλες', 'brussel': 'Βρυξέλλες',
    'αμστερνταμ': 'Άμστερνταμ', 'amsterdam': 'Άμστερνταμ',
    'λουξεμβουργο': 'Λουξεμβούργο', 'luxembourg': 'Λουξεμβούργο',
    'δουβλινο': 'Δουβλίνο', 'dublin': 'Δουβλίνο',
    'βιεννη': 'Βιέννη', 'vienna': 'Βιέννη', 'wien': 'Βιέννη',
    'μαδριτη': 'Μαδρίτη', 'madrid': 'Μαδρίτη',
    'βαρκελωνη': 'Βαρκελώνη', 'barcelona': 'Βαρκελώνη',
    'μιλανο': 'Μιλάνο', 'milan': 'Μιλάνο', 'milano': 'Μιλάνο',
    'ρωμη': 'Ρώμη', 'rome': 'Ρώμη', 'roma': 'Ρώμη',
    'στοκχολμη': 'Στοκχόλμη', 'stockholm': 'Στοκχόλμη',
    'κοπεγχαγη': 'Κοπεγχάγη', 'copenhagen': 'Κοπεγχάγη',
    'φρανκφουρτη': 'Φρανκφούρτη', 'frankfurt': 'Φρανκφούρτη',
    'εδιμβουργο': 'Εδιμβούργο', 'edinburgh': 'Εδιμβούργο',
    'καιμπριτζ': 'Κέιμπριτζ', 'κεημπριτζ': 'Κέιμπριτζ', 'cambridge': 'Κέιμπριτζ',
    'οξφορδη': 'Οξφόρδη', 'oxford': 'Οξφόρδη',
    'νεα υορκη': 'Νέα Υόρκη', 'new york': 'Νέα Υόρκη', 'nyc': 'Νέα Υόρκη', 'new york city': 'Νέα Υόρκη',
    'βοστωνη': 'Βοστώνη', 'boston': 'Βοστώνη',
    'σαν φρανσισκο': 'Σαν Φρανσίσκο', 'san francisco': 'Σαν Φρανσίσκο',
    'τοροντο': 'Τορόντο', 'toronto': 'Τορόντο',
    'σιγκαπουρη': 'Σιγκαπούρη', 'singapore': 'Σιγκαπούρη',
    'ντουμπαι': 'Ντουμπάι', 'dubai': 'Ντουμπάι'
  };

  /* the English names of the cities above, for the English copy of the site */
  var CITY_EN = {
    'Αθήνα': 'Athens', 'Θεσσαλονίκη': 'Thessaloniki', 'Πάτρα': 'Patras', 'Ηράκλειο': 'Heraklion', 'Λάρισα': 'Larissa',
    'Βόλος': 'Volos', 'Ιωάννινα': 'Ioannina', 'Χανιά': 'Chania', 'Πειραιάς': 'Piraeus', 'Λευκωσία': 'Nicosia',
    'Λεμεσός': 'Limassol', 'Λονδίνο': 'London', 'Παρίσι': 'Paris', 'Βερολίνο': 'Berlin', 'Μόναχο': 'Munich',
    'Ζυρίχη': 'Zurich', 'Γενεύη': 'Geneva', 'Βρυξέλλες': 'Brussels', 'Άμστερνταμ': 'Amsterdam', 'Λουξεμβούργο': 'Luxembourg',
    'Δουβλίνο': 'Dublin', 'Βιέννη': 'Vienna', 'Μαδρίτη': 'Madrid', 'Βαρκελώνη': 'Barcelona', 'Μιλάνο': 'Milan',
    'Ρώμη': 'Rome', 'Στοκχόλμη': 'Stockholm', 'Κοπεγχάγη': 'Copenhagen', 'Φρανκφούρτη': 'Frankfurt', 'Εδιμβούργο': 'Edinburgh',
    'Κέιμπριτζ': 'Cambridge', 'Οξφόρδη': 'Oxford', 'Νέα Υόρκη': 'New York', 'Βοστώνη': 'Boston', 'Σαν Φρανσίσκο': 'San Francisco',
    'Τορόντο': 'Toronto', 'Σιγκαπούρη': 'Singapore', 'Ντουμπάι': 'Dubai'
  };

  /** Lower case, no accents, final sigma folded, punctuation to spaces. */
  function fold(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/ς/g, 'σ')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9α-ω]+/g, ' ')
      .replace(/^\s+|\s+$/g, '');
  }

  /* the label in a language: lang 'en' reads the English column (the third
     of a gender or industry, the fourth of a country), anything else Greek */
  function enCol(list) { return list === COUNTRIES ? 3 : 2; }
  function labelIn(list, key, lang) {
    for (var i = 0; i < list.length; i++) if (list[i][0] === key) return list[i][lang === 'en' ? enCol(list) : 1];
    return '';
  }
  /** [[key, label], …] in the order a form lists them: the list's own order,
      except English countries, which sort by their English name (Greece
      first and "another country" last, as in Greek). */
  function choices(kind, lang) {
    var list = kind === 'gender' ? GENDERS : kind === 'industry' ? INDUSTRIES : kind === 'country' ? COUNTRIES : [];
    var col = lang === 'en' ? enCol(list) : 1;
    var out = list.map(function (x) { return [x[0], x[col]]; });
    if (list === COUNTRIES && lang === 'en') {
      var first = out.shift(), last = out.pop();
      out.sort(function (a, b) { return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0; });
      out = [first].concat(out, [last]);
    }
    return out;
  }
  function keysOf(list) { return list.map(function (x) { return x[0]; }); }

  var countryIndex = null;
  /** 'GR' for "Ελλάδα", "Greece", "hellas"…; '' for anything else. */
  function countryCode(text) {
    var f = fold(text);
    if (!f) return '';
    if (!countryIndex) {
      countryIndex = {};
      COUNTRIES.forEach(function (c) {
        if (c[0] === 'XX') return;
        countryIndex[fold(c[1])] = c[0];
        if (c[3] && !(fold(c[3]) in countryIndex)) countryIndex[fold(c[3])] = c[0];
        countryIndex[c[0].toLowerCase()] = c[0];
        (c[2] ? c[2].split('|') : []).forEach(function (a) {
          var k = fold(a);
          if (k && !(k in countryIndex)) countryIndex[k] = c[0];
        });
      });
    }
    return Object.prototype.hasOwnProperty.call(countryIndex, f) ? countryIndex[f] : '';
  }
  function countryName(code, lang) { return labelIn(COUNTRIES, code, lang); }

  /** The first letter of each word in upper case, the rest as typed. */
  function tidy(s) {
    var t = String(s == null ? '' : s).replace(/\s+/g, ' ').replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '');
    if (!t) return '';
    // an ALL-CAPS phrase reads like shouting in a table: give it ordinary
    // case. A short single word stays as typed: it is usually an acronym
    // (KPMG, ACME, ΟΤΕ), and "Kpmg" would be wrong.
    if (t === t.toUpperCase() && t !== t.toLowerCase() && /\S{6,}|\s/.test(t)) t = t.toLowerCase();
    return t.replace(/(^|[\s(\/-])(\S)/g, function (m, a, b) { return a + b.toUpperCase(); });
  }

  /**
   * A free-text place ("London, UK", "Αθήνα", "Greece") split into the city
   * and, when the text names one, the country code. Older profiles kept
   * both in one "Πόλη / Χώρα" box, so this is how their country is counted.
   */
  function splitPlace(text) {
    var raw = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!raw) return { city: '', country: '' };
    var whole = countryCode(raw);
    if (whole) return { city: '', country: whole };
    var parts = raw.split(/\s*[,/;|]\s*|\s+-\s+|\s*\(\s*|\s*\)\s*/).filter(Boolean);
    var country = '';
    if (parts.length > 1) {
      for (var i = parts.length - 1; i > 0; i--) {
        var c = countryCode(parts[i]);
        if (c) { country = c; parts.splice(i, 1); break; }
      }
    }
    return { city: cityName(parts[0] || ''), country: country };
  }

  /** How the statistics name a city: the usual spelling for the cities in
      CITY_ALIASES (in English with lang 'en'), otherwise the text tidied. */
  function cityName(text, lang) {
    var f = fold(text);
    if (!f) return '';
    if (Object.prototype.hasOwnProperty.call(CITY_ALIASES, f)) return lang === 'en' && CITY_EN[CITY_ALIASES[f]] ? CITY_EN[CITY_ALIASES[f]] : CITY_ALIASES[f];
    return tidy(text);
  }

  /** An employer's name folded so that "ΕΜΠ", "Ε.Μ.Π." and "NTUA" are one,
      and "Example S.A." and "EXAMPLE SA" are one. Never shown: it is only
      the key the statistics group by. */
  var ORG_SUFFIXES = /\b(s ?a|a ?e|ae|ike|i k e|ee|oe|ltd|limited|inc|incorporated|corp|corporation|co|company|gmbh|ag|llc|plc|bv|nv|spa|srl|sarl|sas|ab|as|oy|kft|mepe|ε ?π ?ε|α ?ε|ι ?κ ?ε|ο ?ε|ε ?ε)\b/g;
  var ORG_ALIASES = {
    'εμπ': 'ntua', 'ntua': 'ntua', 'εθνικο μετσοβιο πολυτεχνειο': 'ntua',
    'national technical university of athens': 'ntua', 'μετσοβιο': 'ntua', 'μετσοβιο πολυτεχνειο': 'ntua',
    'σεμφε εμπ': 'ntua', 'σεμφε': 'ntua'
  };
  function orgKey(text) {
    var f = fold(String(text == null ? '' : text).replace(/\./g, ''));
    if (!f) return '';
    if (Object.prototype.hasOwnProperty.call(ORG_ALIASES, f)) return ORG_ALIASES[f];
    var k = f.replace(ORG_SUFFIXES, ' ').replace(/\s+/g, ' ').trim();
    if (Object.prototype.hasOwnProperty.call(ORG_ALIASES, k)) return ORG_ALIASES[k];
    return k || f;
  }

  /** "City, Country" for the members' directory card, which has one line
      for both: the country is added unless the city text already names it
      (older profiles typed "London, UK" in one box). What is STORED (the
      directory entry) is written in Greek, lang left out; lang 'en' is for
      showing it on an English page. */
  function placeLine(city, code, lang) {
    var c = String(city == null ? '' : city).replace(/\s+/g, ' ').trim();
    var name = code && code !== 'XX' ? countryName(code, lang) : '';
    if (!name || splitPlace(c).country === code || fold(c) === fold(name)) return c.slice(0, 80);
    return (c ? c + ', ' + name : name).slice(0, 80);
  }

  /** A place line as STORED (Greek: "Λονδίνο, Ηνωμένο Βασίλειο") read on a page
      in another language: lang 'en' turns each comma-separated part that is a
      country, or a city of CITY_ALIASES, into its English name and leaves
      everything else as typed. Any other lang: the text unchanged. */
  function placeText(text, lang) {
    var t = String(text == null ? '' : text);
    if (lang !== 'en' || !/[\u0370-\u03ff\u1f00-\u1fff]/.test(t)) return t;
    return t.split(/(\s*,\s*)/).map(function (part, i) {
      if (i % 2) return part;
      var c = countryCode(part), f = fold(part);
      if (c && c !== 'XX') return countryName(c, 'en');
      if (Object.prototype.hasOwnProperty.call(CITY_ALIASES, f) && CITY_EN[CITY_ALIASES[f]]) return CITY_EN[CITY_ALIASES[f]];
      return part;
    }).join('');
  }

  return {
    GENDERS: GENDERS, INDUSTRIES: INDUSTRIES, COUNTRIES: COUNTRIES,
    GENDER_KEYS: keysOf(GENDERS), INDUSTRY_KEYS: keysOf(INDUSTRIES), COUNTRY_KEYS: keysOf(COUNTRIES),
    genderLabel: function (k, lang) { return labelIn(GENDERS, k, lang); },
    industryLabel: function (k, lang) { return labelIn(INDUSTRIES, k, lang); },
    choices: choices,
    countryName: countryName,
    countryCode: countryCode,
    fold: fold, tidy: tidy, splitPlace: splitPlace, cityName: cityName, orgKey: orgKey, placeLine: placeLine, placeText: placeText
  };
}));
