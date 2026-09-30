/* Offline tests for feedback.js (the Σχόλια page's e-mails).
   No network, no Firebase, no mail server. Run: npm test */
'use strict';
const assert = require('node:assert');
const fb = require('./feedback');

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('ok    ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e && e.stack || e)); }
}

const CFG = { site: 'https://www.stouras.com/semfealumni/', to: ['kstouras@gmail.com'], from: '"SEMFE" <semfe@gmail.com>', replyTo: 'kstouras@gmail.com' };
const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
const DOC = (o) => Object.assign({
  ticket: 'SEMFE-260930-AB23', uid: 'u1', email: 'maria@gmail.com', emailVerified: true, name: 'Μαρία',
  kind: 'problem', message: 'Το κουμπί <b>Αποστολή</b> δεν κάνει τίποτα.\nΣτο κινητό.', page: 'https://www.stouras.com/semfealumni/account/',
  screenshots: [JPEG], ua: 'UA', status: 'open', createdAt: 'T'
}, o || {});
/* a document store with one feedback doc, and a mailbox */
function world(doc, opts) {
  opts = opts || {};
  const state = { doc: Object.assign({}, doc) }, sent = [], updates = [];
  const deps = {
    now: () => 'NOW',
    claim: async (field, value) => {
      const cur = state.doc[field];
      if (typeof value === 'string' ? cur === value : cur != null) return false;
      state.doc[field] = value; return true;
    },
    update: async p => { updates.push(p); Object.assign(state.doc, p); },
    send: async m => { if (opts.fail && opts.fail(m)) { const e = new Error('Invalid login'); e.code = 'EAUTH'; throw e; } sent.push(m); }
  };
  return { state, sent, updates, deps };
}

(async () => {
  await t('a new message: a copy to the admins (screenshots attached, reply goes to the sender) and a confirmation to the sender', async () => {
    const w = world(DOC());
    const r = await fb.onCreated('SEMFE-260930-AB23', w.state.doc, w.deps, CFG);
    assert.strictEqual(r, 'sent');
    assert.strictEqual(w.sent.length, 2);
    const [admin, ack] = w.sent;
    assert.strictEqual(admin.to, 'kstouras@gmail.com'); assert.strictEqual(admin.replyTo, 'maria@gmail.com');
    assert.ok(admin.subject.startsWith('[SEMFE-260930-AB23] Πρόβλημα: Το κουμπί'));
    assert.strictEqual(admin.attachments.length, 1); assert.strictEqual(admin.attachments[0].filename, 'SEMFE-260930-AB23-1.jpg');
    assert.deepStrictEqual([...admin.attachments[0].content.slice(0, 3)], [0xff, 0xd8, 0xff]);
    assert.ok(admin.html.includes('admin/#feedback'));
    assert.strictEqual(ack.to, 'maria@gmail.com'); assert.strictEqual(ack.subject, '[SEMFE-260930-AB23] Λάβαμε το μήνυμά σας');
    assert.ok(ack.text.includes('SEMFE-260930-AB23') && ack.html.includes('feedback/'));
    assert.ok(!ack.attachments, 'the confirmation carries no screenshots');
    assert.strictEqual(w.state.doc.mailedAt, 'NOW'); assert.strictEqual(w.state.doc.ackAt, 'NOW');
  });
  await t('the text is escaped in the HTML (a message cannot inject markup into the e-mail)', async () => {
    const m = fb.renderAdmin(DOC({ name: '<img src=x onerror=alert(1)>' }), CFG);
    assert.ok(!m.html.includes('<b>Αποστολή') && m.html.includes('&lt;b&gt;Αποστολή'));
    assert.ok(!m.html.includes('<img src=x'));
    assert.ok(m.html.includes('<br>'), 'line breaks kept');
  });
  await t('an unconfirmed address, or none, gets no e-mail; the admins still do', async () => {
    for (const o of [{ emailVerified: false }, { email: '' }, { email: 'not-an-address', emailVerified: true }]) {
      const w = world(DOC(o));
      assert.strictEqual(await fb.onCreated('SEMFE-260930-AB23', w.state.doc, w.deps, CFG), 'sent');
      assert.strictEqual(w.sent.length, 1); assert.strictEqual(w.sent[0].to, 'kstouras@gmail.com');
      assert.ok(!w.state.doc.ackAt);
    }
    const w = world(DOC({ email: '' }));
    await fb.onCreated('SEMFE-260930-AB23', w.state.doc, w.deps, CFG);
    assert.strictEqual(w.sent[0].replyTo, undefined, 'no Reply-To without an address');
  });
  await t('never twice: an already mailed ticket, or a lost claim, sends nothing', async () => {
    let w = world(DOC({ mailedAt: 'EARLIER' }));
    assert.strictEqual(await fb.onCreated('SEMFE-260930-AB23', w.state.doc, w.deps, CFG), 'already');
    w = world(DOC());
    w.deps.claim = async () => false;
    assert.strictEqual(await fb.onCreated('SEMFE-260930-AB23', w.state.doc, w.deps, CFG), 'already');
    assert.strictEqual(w.sent.length, 0);
  });
  await t('a document that is not a ticket is ignored', async () => {
    for (const [id, d] of [['random-id', DOC()], ['SEMFE-260930-AB23', DOC({ ticket: 'SEMFE-260930-ZZZZ' })], ['SEMFE-260930-AB23', null]]) {
      const w = world(d || {});
      assert.strictEqual(await fb.onCreated(id, d, w.deps, CFG), 'skip');
      assert.strictEqual(w.sent.length, 0);
    }
  });
  await t('a mail server failure is written to mailError (the admin page shows it), nothing thrown', async () => {
    const w = world(DOC(), { fail: m => m.to === 'maria@gmail.com' });
    assert.strictEqual(await fb.onCreated('SEMFE-260930-AB23', w.state.doc, w.deps, CFG), 'errors');
    assert.ok(/επιβεβαίωση: EAUTH: Invalid login/.test(w.state.doc.mailError));
    assert.strictEqual(w.sent.length, 1, 'the admin copy still went');
  });
  await t('screenshots: only real JPEG data URLs are attached', async () => {
    const a = fb.attachmentsOf(DOC({ screenshots: [JPEG, 'data:text/html;base64,PHNjcmlwdD4=', 'https://evil.example/x.jpg', null] }));
    assert.strictEqual(a.length, 1);
  });

  await t('closing a ticket with an answer e-mails it to the sender, once', async () => {
    const d = DOC({ status: 'closed', resolution: 'Διορθώθηκε: το κουμπί λειτουργεί και στο κινητό.', resolutionUrl: 'https://www.stouras.com/semfealumni/account/', mailedAt: 'X' });
    const w = world(d);
    assert.strictEqual(await fb.onUpdated('SEMFE-260930-AB23', DOC(), w.state.doc, w.deps, CFG), 'sent');
    assert.strictEqual(w.sent.length, 1);
    const m = w.sent[0];
    assert.strictEqual(m.to, 'maria@gmail.com'); assert.strictEqual(m.replyTo, 'kstouras@gmail.com');
    assert.strictEqual(m.subject, '[SEMFE-260930-AB23] Απάντηση στο μήνυμά σας');
    assert.ok(m.text.includes('Διορθώθηκε') && m.text.includes('Δείτε το: https://www.stouras.com/semfealumni/account/') && m.text.includes('Το κουμπί <b>'));
    assert.strictEqual(w.state.doc.resolutionSentHash, fb.resolutionHash(d)); assert.strictEqual(w.state.doc.resolutionSentAt, 'NOW');
    // the function's own write fires the trigger again: nothing more is sent
    assert.strictEqual(await fb.onUpdated('SEMFE-260930-AB23', d, w.state.doc, w.deps, CFG), 'already');
    assert.strictEqual(w.sent.length, 1);
  });
  await t('an edited answer is sent again; reopening sends nothing', async () => {
    const d = DOC({ status: 'closed', resolution: 'Α', resolutionSentHash: fb.resolutionHash({ resolution: 'Α' }) });
    let w = world(Object.assign({}, d, { resolution: 'Β' }));
    assert.strictEqual(await fb.onUpdated('SEMFE-260930-AB23', d, w.state.doc, w.deps, CFG), 'sent');
    w = world(Object.assign({}, d, { status: 'open' }));
    assert.strictEqual(await fb.onUpdated('SEMFE-260930-AB23', d, w.state.doc, w.deps, CFG), 'skip');
    assert.strictEqual(w.sent.length, 0);
  });
  await t('an answer to someone without a confirmed address is not mailed (they see it on the page)', async () => {
    const w = world(DOC({ status: 'closed', resolution: 'OK', emailVerified: false }));
    assert.strictEqual(await fb.onUpdated('SEMFE-260930-AB23', null, w.state.doc, w.deps, CFG), 'no-address');
    assert.strictEqual(w.sent.length, 0);
  });
  await t('an answer that fails to send is recorded, and not retried in a loop', async () => {
    const w = world(DOC({ status: 'closed', resolution: 'OK' }), { fail: () => true });
    assert.strictEqual(await fb.onUpdated('SEMFE-260930-AB23', null, w.state.doc, w.deps, CFG), 'errors');
    assert.ok(/^απάντηση: EAUTH/.test(w.state.doc.mailError));
    assert.strictEqual(await fb.onUpdated('SEMFE-260930-AB23', null, w.state.doc, w.deps, CFG), 'already');
  });
  await t('only an https link is offered in the answer', async () => {
    const m = fb.renderResolution(DOC({ resolution: 'OK', resolutionUrl: 'javascript:alert(1)' }), CFG);
    assert.ok(!m.html.includes('javascript:') && !m.text.includes('javascript:'));
  });
  await t('the links in the e-mails follow SITE_URL (a move to another address changes one setting)', async () => {
    const cfg = Object.assign({}, CFG, { site: 'https://semfealumni.gr/' });
    assert.ok(fb.renderAck(DOC(), cfg).html.includes('https://semfealumni.gr/feedback/'));
    assert.ok(fb.renderAdmin(DOC(), cfg).text.includes('https://semfealumni.gr/admin/#feedback'));
    assert.ok(!fb.renderAck(DOC(), cfg).html.includes('stouras.com'));
  });

  console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nall ${passed} passed`);
  process.exit(failed ? 1 : 0);
})();
