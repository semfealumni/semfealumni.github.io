---
path: blog/
nav: blog
scripts: [announce-text.js, announce.js]
title: Ανακοινώσεις
description: Ανακοινώσεις, προσκλήσεις και εκδηλώσεις του Συλλόγου Διπλωματούχων ΣΕΜΦΕ ΕΜΠ.
hero:
  eyebrow: Νέα
  title: Ανακοινώσεις
  lede: Προσκλήσεις, εκδηλώσεις και μηνύματα του Διοικητικού Συμβουλίου.
crumbs:
  - [Ανακοινώσεις, null]
---

<section class="tight">
<div class="wrap">
<div class="announce" data-announce hidden>
  <div class="announce-bar">
    <button type="button" class="btn btn-dark" data-announce-open aria-expanded="false" aria-controls="announce-box">{{icon:form}} Νέα ανακοίνωση</button>
    <p class="muted">Ορατό μόνο στους διαχειριστές.</p>
  </div>
  <div id="announce-box" data-announce-box hidden></div>
</div>
<div class="filters" role="group" aria-label="Φίλτρο κατηγορίας" data-post-filter hidden>
  <button type="button" aria-pressed="true" data-cat="">Όλες</button>
  <button type="button" aria-pressed="false" data-cat="Ανακοινώσεις">Ανακοινώσεις</button>
  <button type="button" aria-pressed="false" data-cat="Εκδηλώσεις">Εκδηλώσεις</button>
</div>

## Όλες οι ανακοινώσεις { .sr-only }

<p class="sr-only" data-post-count role="status"></p>
{{posts}}
<div class="follow">

**Μη χάνετε καμία ανακοίνωση.** Λάβετε τις ανακοινώσεις και τις εκδηλώσεις με e-mail, ή ακολουθήστε τες σε ένα πρόγραμμα ανάγνωσης ειδήσεων (RSS / Atom).

<div class="follow-links">
  <a class="btn btn-dark btn-sm" href="{{root}}account/#alerts">{{icon:mail}} Ειδοποιήσεις με e-mail</a>
  <a class="btn btn-outline btn-sm" href="{{root}}rss.xml" type="application/rss+xml">{{icon:rss}} RSS</a>
  <a class="btn btn-outline btn-sm" href="{{root}}feed.xml" type="application/atom+xml">{{icon:rss}} Atom</a>
</div>
</div>
</div>
</section>
