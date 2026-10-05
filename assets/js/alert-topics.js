/* SEMFE Alumni: the e-mail alerts a registered member can choose, one per
   kind of news. ONE definition, used in three places, so they cannot disagree:
     - the «Ειδοποιήσεις με e-mail» card on account/ draws its check boxes
       from TOPICS (<script src="assets/js/alert-topics.js"> -> window.SEMFE_ALERTS);
     - the Cloud Function that sends the e-mails (functions/alerts.js ->
       require) decides from it which news belongs to which alert;
     - firestore.rules lists the same keys in alertTopics(), and the fields a
       member may write in alertPrefs/{uid} (tools/check.mjs fails when they
       differ).
   functions/alert-topics.js is a byte-for-byte COPY of this file, because a
   Cloud Function deploy ships only the functions/ folder. Edit this one and
   copy it over: tools/check.mjs fails when the two differ.

   WHERE EACH ALERT'S NEWS COMES FROM
     source 'news'   an entry of «Τι νέο» (changelog.json) once an admin has
                     approved it (assets/js/news.js decides what is public)
     source 'posts'  an announcement (_src/posts/) whose category is
                     `category`, as published in feed.json
   A new kind of alert is one more line here, one more key in alertTopics()
   in firestore.rules, and (for posts) the category on the posts.

   The keys are stored, never the labels, so a label can be reworded without
   touching anyone's choice. Written in ES5 for every browser the site supports. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SEMFE_ALERTS = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TOPICS = [
    { key: 'announcements', source: 'posts', category: 'Ανακοινώσεις',
      label: 'Ανακοινώσεις του Συλλόγου',
      hint: 'Τα σημαντικά νέα του Συλλόγου: ανακοινώσεις και προσκλήσεις του Διοικητικού Συμβουλίου, γενικές συνελεύσεις, συνδρομές.' },
    { key: 'events', source: 'posts', category: 'Εκδηλώσεις',
      label: 'Εκδηλώσεις και συναντήσεις',
      hint: 'Συναντήσεις αποφοίτων, ομιλίες και άλλες εκδηλώσεις.' },
    { key: 'site', source: 'news',
      label: 'Νέα του ιστότοπου',
      hint: 'Οι αλλαγές και οι νέες δυνατότητες του ιστότοπου, όπως τις δημοσιεύει το Δ.Σ. στο «Τι νέο».' }
  ];
  var KEYS = TOPICS.map(function (t) { return t.key; });

  /* what a member may write in alertPrefs/{uid}; `k` (the key of the
     unsubscribe link) is written only by the Cloud Function */
  var DOC_KEYS = ['topics', 'email', 'updatedAt'];
  var SERVER_KEYS = ['k'];

  function byKey(k) {
    for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i].key === k) return TOPICS[i];
    return null;
  }

  /** The alert an announcement of this category belongs to ('' = none). */
  function topicOfCategory(cat) {
    for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i].source === 'posts' && TOPICS[i].category === cat) return TOPICS[i].key;
    return '';
  }

  /** A stored choice made safe: known keys only, once each, in TOPICS order. */
  function clean(list) {
    var want = Object.prototype.toString.call(list) === '[object Array]' ? list : [];
    return KEYS.filter(function (k) { return want.indexOf(k) !== -1; });
  }

  return { TOPICS: TOPICS, KEYS: KEYS, DOC_KEYS: DOC_KEYS, SERVER_KEYS: SERVER_KEYS, byKey: byKey, topicOfCategory: topicOfCategory, clean: clean };
}));
