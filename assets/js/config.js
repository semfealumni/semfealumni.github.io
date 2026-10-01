/* SEMFE Alumni: the settings that change. Loaded on every page before
 * site.js and auth.js.
 *
 *  1. FIREBASE: paste the web-app config from the Firebase console
 *     (Project settings > General > Your apps > SDK setup and configuration >
 *     Config). While any value still says PASTE_, sign-in stays switched off
 *     and the "Σύνδεση" button explains that registration opens soon. Nothing
 *     else on the site depends on it. Full walkthrough: FIREBASE-SETUP.md.
 *     These values are NOT secrets: every Firebase web app ships them to the
 *     browser. Access is controlled by firestore.rules.
 *
 *  2. AUTH_PROVIDERS: the sign-in buttons, in display order. List a provider
 *     only once it is enabled in Firebase console > Authentication >
 *     Sign-in method (a button for a provider that is not enabled fails with
 *     a clear message, but it is better not to show it at all).
 *       'google'   – Google / Gmail (built in)
 *       'facebook' – Facebook (built in; needs a Meta app). Left out on
 *                    purpose for now; Part C of the guide, if ever wanted.
 *       'linkedin' – LinkedIn (see LINKEDIN below and Part D of the guide)
 *     E-mail + password is always offered when Email/Password is enabled.
 *     The pages that name the ways to sign in (account, privacy, terms,
 *     support, data deletion) follow this list: rebuild them with
 *     `node tools/build.mjs` after changing it or the LINKEDIN settings.
 *
 *  3. ADMIN_EMAILS: who sees the "Διαχείριση" (admin) page. This list only
 *     decides what the page SHOWS. What an admin may actually read and write
 *     is decided by isAdmin() in firestore.rules, which must list the same
 *     addresses (tools/check.mjs fails when the two differ).
 *
 *  4. ANALYTICS: the two counters behind the «Στατιστικά» page
 *     (ANALYTICS-SETUP.md). Both run only on the live site (hosts) and never
 *     for a visitor who asks not to be tracked; neither stores anything on
 *     the visitor's device (assets/js/visit.js).
 *       ga4       the Google Analytics 4 Measurement ID (G-…). Not a secret.
 *                 While it says PASTE_, Google Analytics is not loaded.
 *       visitUrl  the recordVisit Cloud Function (functions/index.js), the
 *                 site's own counter. Until it is deployed the message
 *                 simply goes unanswered; nothing breaks.
 */
window.SEMFE = {
  siteName: 'Σύλλογος Διπλωματούχων ΣΕΜΦΕ ΕΜΠ',
  siteUrl: 'https://semfealumni.gr/',
  contactEmail: 'gradsemfe@gmail.com',
  contactFormUrl: 'https://docs.google.com/forms/viewform?hl=el&id=1rZeseSmD0GuyX7PXSSkZcFyuDejSqNe7hMxCUdFja-8',
  /* The association's old Google Form. Shown as the way to apply only while
     sign-in is switched off (FIREBASE still has PASTE_ values). */
  legacyApplyFormUrl: 'https://goo.gl/F3AzdU',
  annualFee: 10,

  FIREBASE: {
    apiKey: 'AIzaSyBOcWAPSn4FgZtH70J4OntxeZ42zhnZgQE',
    authDomain: 'semfe-alumni.firebaseapp.com',
    projectId: 'semfe-alumni',
    storageBucket: 'semfe-alumni.firebasestorage.app',
    messagingSenderId: '478387432992',
    appId: '1:478387432992:web:516c049d52286994875645'
  },

  AUTH_PROVIDERS: ['google', 'linkedin'],   // Google, LinkedIn and e-mail only (Facebook left out for now)

  /* LinkedIn has two routes (FIREBASE-SETUP.md, Part D):
       mode 'function'  the recommended one: LinkedIn sends the member back to
                        auth/linkedin/ and the linkedinSignIn Cloud Function
                        (functions/) signs them in. Needs clientId (the
                        LinkedIn app's Client ID, which is public) and
                        functionUrl (printed by `firebase deploy --only
                        functions`). The button stays hidden until both are
                        filled in.
       mode 'oidc'      Firebase's built-in OpenID Connect provider, whose id
                        must be EXACTLY providerId. Shorter to set up, but it
                        has a known bug with LinkedIn (see the guide). */
  LINKEDIN: {
    mode: 'function',
    clientId: '77fnj59vqhvj3b',
    functionUrl: 'https://linkedinsignin-s73s2jpqrq-ew.a.run.app',
    providerId: 'oidc.linkedin'
  },

  ADMIN_EMAILS: ['kstouras@gmail.com', 'gradsemfe@gmail.com'],

  ANALYTICS: {
    ga4: 'G-8SSJKNQNR1',            // property "SEMFE Alumni - GA4" (361541833), stream www.semfealumni.gr
    visitUrl: 'https://europe-west1-semfe-alumni.cloudfunctions.net/recordVisit',
    hosts: ['semfealumni.gr', 'www.semfealumni.gr']
  },

  /* The Firebase JavaScript SDK version loaded from gstatic.com. */
  FIREBASE_SDK: '12.19.0'
};
