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

  /* 'na' = "I prefer not to say": a real answer, never counted as one */
  var GENDERS = [
    ['female', 'Γυναίκα'],
    ['male', 'Άνδρας'],
    ['other', 'Άλλο'],
    ['na', 'Δεν επιθυμώ να απαντήσω']
  ];

  var INDUSTRIES = [
    ['academia', 'Πανεπιστήμιο & Έρευνα'],
    ['education', 'Εκπαίδευση'],
    ['studies', 'Μεταπτυχιακές / διδακτορικές σπουδές'],
    ['software', 'Πληροφορική & Λογισμικό'],
    ['data', 'Δεδομένα & Τεχνητή Νοημοσύνη'],
    ['telecom', 'Τηλεπικοινωνίες'],
    ['finance', 'Τράπεζες & Χρηματοοικονομικά'],
    ['insurance', 'Ασφάλειες & Αναλογιστική'],
    ['consulting', 'Συμβουλευτικές υπηρεσίες'],
    ['energy', 'Ενέργεια'],
    ['manufacturing', 'Βιομηχανία & Παραγωγή'],
    ['engineering', 'Τεχνικά έργα & Κατασκευές'],
    ['health', 'Υγεία & Ιατρική Φυσική'],
    ['pharma', 'Φαρμακευτική & Βιοτεχνολογία'],
    ['defence', 'Άμυνα & Αεροδιαστημική'],
    ['transport', 'Μεταφορές & Εφοδιαστική'],
    ['public', 'Δημόσιος τομέας'],
    ['commerce', 'Εμπόριο & Υπηρεσίες'],
    ['media', 'Μέσα ενημέρωσης & Επικοινωνία'],
    ['other', 'Άλλο']
  ];

  /* ISO 3166 code, Greek name, and the other ways people write it, as
     phrases separated by | (folded: lower case, no accents). 'XX' is
     "another country". Greece first, then the Greek names alphabetically
     (the form shows them in this order). */
  var COUNTRIES = [
    ['GR', 'Ελλάδα', 'greece|hellas|ellada|ellas|ελλας|hellenic republic'],
    ['AL', 'Αλβανία', 'albania'],
    ['AR', 'Αργεντινή', 'argentina'],
    ['AU', 'Αυστραλία', 'australia'],
    ['AT', 'Αυστρία', 'austria|osterreich'],
    ['BE', 'Βέλγιο', 'belgium|belgique|belgie'],
    ['MK', 'Βόρεια Μακεδονία', 'north macedonia|fyrom'],
    ['BG', 'Βουλγαρία', 'bulgaria'],
    ['BR', 'Βραζιλία', 'brazil|brasil'],
    ['FR', 'Γαλλία', 'france'],
    ['DE', 'Γερμανία', 'germany|deutschland'],
    ['DK', 'Δανία', 'denmark|danmark'],
    ['EE', 'Εσθονία', 'estonia'],
    ['CH', 'Ελβετία', 'switzerland|schweiz|suisse|svizzera'],
    ['AE', 'Ηνωμένα Αραβικά Εμιράτα', 'united arab emirates|uae|dubai|abu dhabi|εμιρατα'],
    ['GB', 'Ηνωμένο Βασίλειο', 'united kingdom|uk|u k|great britain|britain|england|scotland|wales|αγγλια|βρετανια|μεγαλη βρετανια'],
    ['US', 'ΗΠΑ', 'united states|usa|u s a|us|u s|america|united states of america|ηνωμενες πολιτειες|αμερικη'],
    ['JP', 'Ιαπωνία', 'japan'],
    ['IN', 'Ινδία', 'india'],
    ['IE', 'Ιρλανδία', 'ireland|eire'],
    ['IS', 'Ισλανδία', 'iceland'],
    ['ES', 'Ισπανία', 'spain|espana'],
    ['IL', 'Ισραήλ', 'israel'],
    ['IT', 'Ιταλία', 'italy|italia'],
    ['CA', 'Καναδάς', 'canada'],
    ['QA', 'Κατάρ', 'qatar'],
    ['CN', 'Κίνα', 'china'],
    ['CY', 'Κύπρος', 'cyprus|kypros'],
    ['HR', 'Κροατία', 'croatia|hrvatska'],
    ['LV', 'Λετονία', 'latvia'],
    ['LT', 'Λιθουανία', 'lithuania'],
    ['LU', 'Λουξεμβούργο', 'luxembourg'],
    ['MT', 'Μάλτα', 'malta'],
    ['MX', 'Μεξικό', 'mexico'],
    ['NO', 'Νορβηγία', 'norway|norge'],
    ['KR', 'Νότια Κορέα', 'south korea|korea'],
    ['ZA', 'Νότια Αφρική', 'south africa'],
    ['NZ', 'Νέα Ζηλανδία', 'new zealand'],
    ['NL', 'Ολλανδία', 'netherlands|the netherlands|holland|nederland|κατω χωρες'],
    ['HU', 'Ουγγαρία', 'hungary'],
    ['PL', 'Πολωνία', 'poland|polska'],
    ['PT', 'Πορτογαλία', 'portugal'],
    ['RO', 'Ρουμανία', 'romania'],
    ['SA', 'Σαουδική Αραβία', 'saudi arabia'],
    ['RS', 'Σερβία', 'serbia'],
    ['SG', 'Σιγκαπούρη', 'singapore'],
    ['SK', 'Σλοβακία', 'slovakia'],
    ['SI', 'Σλοβενία', 'slovenia'],
    ['SE', 'Σουηδία', 'sweden|sverige'],
    ['TR', 'Τουρκία', 'turkey|turkiye'],
    ['CZ', 'Τσεχία', 'czechia|czech republic'],
    ['FI', 'Φινλανδία', 'finland|suomi'],
    ['HK', 'Χονγκ Κονγκ', 'hong kong'],
    ['CL', 'Χιλή', 'chile'],
    ['XX', 'Άλλη χώρα', '']
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

  /** Lower case, no accents, final sigma folded, punctuation to spaces. */
  function fold(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/ς/g, 'σ')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9α-ω]+/g, ' ')
      .replace(/^\s+|\s+$/g, '');
  }

  function labelIn(list, key) {
    for (var i = 0; i < list.length; i++) if (list[i][0] === key) return list[i][1];
    return '';
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
        countryIndex[c[0].toLowerCase()] = c[0];
        (c[2] ? c[2].split('|') : []).forEach(function (a) {
          var k = fold(a);
          if (k && !(k in countryIndex)) countryIndex[k] = c[0];
        });
      });
    }
    return Object.prototype.hasOwnProperty.call(countryIndex, f) ? countryIndex[f] : '';
  }
  function countryName(code) { return labelIn(COUNTRIES, code); }

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
      CITY_ALIASES, otherwise the text tidied. */
  function cityName(text) {
    var f = fold(text);
    if (!f) return '';
    if (Object.prototype.hasOwnProperty.call(CITY_ALIASES, f)) return CITY_ALIASES[f];
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
      (older profiles typed "London, UK" in one box). */
  function placeLine(city, code) {
    var c = String(city == null ? '' : city).replace(/\s+/g, ' ').trim();
    var name = code && code !== 'XX' ? countryName(code) : '';
    if (!name || splitPlace(c).country === code || fold(c) === fold(name)) return c.slice(0, 80);
    return (c ? c + ', ' + name : name).slice(0, 80);
  }

  return {
    GENDERS: GENDERS, INDUSTRIES: INDUSTRIES, COUNTRIES: COUNTRIES,
    GENDER_KEYS: keysOf(GENDERS), INDUSTRY_KEYS: keysOf(INDUSTRIES), COUNTRY_KEYS: keysOf(COUNTRIES),
    genderLabel: function (k) { return labelIn(GENDERS, k); },
    industryLabel: function (k) { return labelIn(INDUSTRIES, k); },
    countryName: countryName,
    countryCode: countryCode,
    fold: fold, tidy: tidy, splitPlace: splitPlace, cityName: cityName, orgKey: orgKey, placeLine: placeLine
  };
}));
