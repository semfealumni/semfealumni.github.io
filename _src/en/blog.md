---
path: blog/
nav: blog
scripts: [announce-text.js, announce.js]
title: Announcements
description: Announcements, invitations and events of the SEMFE Alumni Association.
hero:
  eyebrow: News
  title: Announcements
  lede: Invitations, events and messages from the Board of Directors, published in Greek.
crumbs:
  - [Announcements, null]
---

<section class="tight">
<div class="wrap">
<div class="announce" data-announce hidden>
  <div class="announce-bar">
    <button type="button" class="btn btn-dark" data-announce-open aria-expanded="false" aria-controls="announce-box">{{icon:form}} New announcement</button>
    <p class="muted">Visible to administrators only.</p>
  </div>
  <div id="announce-box" data-announce-box hidden></div>
</div>
<div class="filters" role="group" aria-label="Category filter" data-post-filter hidden>
  <button type="button" aria-pressed="true" data-cat="">All</button>
  <button type="button" aria-pressed="false" data-cat="Ανακοινώσεις">Announcements</button>
  <button type="button" aria-pressed="false" data-cat="Εκδηλώσεις">Events</button>
</div>

## All announcements { .sr-only }

<p class="sr-only" data-post-count role="status"></p>
{{posts}}
<div class="follow">

**Never miss an announcement.** Get the announcements and events by e-mail, or follow them in a news reader (RSS / Atom).

<div class="follow-links">
  <a class="btn btn-dark btn-sm" href="{{root}}account/#alerts">{{icon:mail}} E-mail alerts</a>
  <a class="btn btn-outline btn-sm" href="{{root}}rss.xml" type="application/rss+xml" data-feed="RSS">{{icon:rss}} RSS</a>
  <a class="btn btn-outline btn-sm" href="{{root}}feed.xml" type="application/atom+xml" data-feed="Atom">{{icon:rss}} Atom</a>
</div>
</div>
</div>
</section>
