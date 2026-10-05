---
path: analytics/
nav: ""
scripts: [profile-options.js, analytics-page.js]
title: Statistics
description: >-
  How many people visit the website of the SEMFE Alumni Association, from which
  countries, cities, universities and companies, and anonymous statistics about our members.
hero:
  eyebrow: The website
  title: Statistics
  lede: How many people visit us, from where and how, and, anonymously, who our registered members are.
crumbs:
  - [Statistics, null]
---

<section class="tight">
  <div class="wrap">
    <!-- drawn by assets/js/analytics-page.js from data/analytics.json (the
         visits, rebuilt daily by tools/build-analytics.mjs) and from the
         members' anonymous statistics (Firestore publicStats/members) -->
    <div id="analytics-app">
      <noscript><div class="notice warn"><strong>JavaScript is required</strong><p>The charts are drawn in your browser from the file <a href="{{root}}data/analytics.json">data/analytics.json</a>.</p></div></noscript>
      <div class="loading"><span class="spinner" aria-hidden="true"></span>Loading…</div>
    </div>
  </div>
</section>
