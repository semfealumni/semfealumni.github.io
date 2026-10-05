---
path: analytics/
nav: ""
scripts: [profile-options.js, analytics-page.js]
title: Στατιστικά
description: >-
  Πόσοι επισκέπτονται τον ιστότοπο του Συλλόγου Διπλωματούχων ΣΕΜΦΕ ΕΜΠ, από ποιες χώρες,
  πόλεις, πανεπιστήμια και εταιρείες, και ανώνυμα στατιστικά των μελών μας.
hero:
  eyebrow: Ο ιστότοπος
  title: Στατιστικά
  lede: Πόσοι μας επισκέπτονται, από πού και πώς, και ποιοι είναι, ανώνυμα, όσοι έχουν εγγραφεί.
crumbs:
  - [Στατιστικά, null]
---

<section class="tight">
  <div class="wrap">
    <!-- drawn by assets/js/analytics-page.js from data/analytics.json (the
         visits, rebuilt daily by tools/build-analytics.mjs) and from the
         members' anonymous statistics (Firestore publicStats/members) -->
    <div id="analytics-app">
      <noscript><div class="notice warn"><strong>Χρειάζεται JavaScript</strong><p>Τα διαγράμματα σχεδιάζονται στον browser από το αρχείο <a href="{{root}}data/analytics.json">data/analytics.json</a>.</p></div></noscript>
      <div class="loading"><span class="spinner" aria-hidden="true"></span>Φόρτωση…</div>
    </div>
  </div>
</section>
