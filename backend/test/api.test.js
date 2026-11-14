import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

const KEY_SECRET = 'test_key_secret';
const WEBHOOK_SECRET = 'test_webhook_secret';
const ADMIN_KEY = 'admin-key-123';

let server, base, orders;

function startApp({ withGateway = true, settlementMode = 'platform' } = {}) {
  orders = [];
  const gateway = withGateway
    ? {
        keyId: 'rzp_test_abc',
        async createOrder(body) {
          const order = { id: `order_${orders.length + 1}`, ...body };
          orders.push(order);
          return order;
        },
      }
    : null;
  const app = createApp({
    db: openDb(':memory:'),
    gateway,
    config: { keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET, settlementMode, adminKey: ADMIN_KEY, feePercent: 2, rateLimitScale: 1000 },
  });
  return new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
}

async function call(method, path, { body, token, headers = {}, raw } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body || raw ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text };
}

async function createRegistry(over = {}) {
  const r = await call('POST', '/api/registries', {
    body: { partner1: 'Aarav', partner2: 'Meera', upiId: 'aarav@okhdfcbank', ...over },
  });
  return r;
}

const sign = (orderId, paymentId) => crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

before(async () => {
  server = await startApp();
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('creating a wishlist seeds the three reel dreams and returns an owner token', async () => {
  const r = await createRegistry();
  assert.equal(r.status, 201);
  assert.match(r.json.slug, /^[a-z2-9]{8}$/);
  assert.equal(r.json.ownerToken.length, 64);

  const v = await call('GET', `/api/r/${r.json.slug}`);
  assert.equal(v.status, 200);
  assert.equal(v.json.coupleName, 'Aarav & Meera');
  assert.deepEqual(v.json.dreams.map((d) => d.target), [300000, 1000000, 250000]);
  assert.equal(v.json.totalGoal, 1550000);
  assert.equal(v.json.totalRaised, 0);
  assert.equal(v.json.pending, undefined, 'public view must not leak pending list');
});

test('rejects bad UPI id and empty name', async () => {
  assert.equal((await createRegistry({ upiId: 'not-a-upi' })).status, 400);
  assert.equal((await createRegistry({ partner1: '  ' })).status, 400);
});

test('owner endpoints require the right token', async () => {
  const { json: reg } = await createRegistry();
  assert.equal((await call('GET', `/api/r/${reg.slug}/owner`)).status, 401);
  assert.equal((await call('GET', `/api/r/${reg.slug}/owner`, { token: 'wrong' })).status, 401);
  assert.equal((await call('GET', `/api/r/${reg.slug}/owner`, { token: reg.ownerToken })).status, 200);
  assert.equal((await call('POST', `/api/r/${reg.slug}/dreams`, { body: { title: 'x', target: 1000 } })).status, 401);
});

test('owner can add, edit and delete a dream; token of another wishlist is useless', async () => {
  const a = (await createRegistry()).json;
  const b = (await createRegistry({ partner1: 'Other' })).json;

  const add = await call('POST', `/api/r/${a.slug}/dreams`, { token: a.ownerToken, body: { emoji: '🏍️', title: 'Bike trip', target: 80000 } });
  assert.equal(add.status, 201);
  const dream = add.json.dreams.find((d) => d.title === 'Bike trip');
  assert.ok(dream);

  const foreign = await call('PUT', `/api/r/${a.slug}/dreams/${dream.id}`, { token: b.ownerToken, body: { title: 'hacked', target: 1000 } });
  assert.equal(foreign.status, 401);

  const edit = await call('PUT', `/api/r/${a.slug}/dreams/${dream.id}`, { token: a.ownerToken, body: { emoji: '🏔️', title: 'Ladakh trip', target: 90000 } });
  assert.equal(edit.json.dreams.find((d) => d.id === dream.id).title, 'Ladakh trip');

  const del = await call('DELETE', `/api/r/${a.slug}/dreams/${dream.id}`, { token: a.ownerToken });
  assert.equal(del.status, 200);
  assert.ok(!del.json.dreams.some((d) => d.id === dream.id));
});

test('online payment: order created, signature verified, progress updates, idempotent', async () => {
  const { json: reg } = await createRegistry();
  const pub = (await call('GET', `/api/r/${reg.slug}`)).json;
  assert.equal(pub.onlinePayments, true);
  const dreamId = pub.dreams[0].id;

  const c = await call('POST', `/api/r/${reg.slug}/contribute`, { body: { dreamId, amount: 2000, guest: 'Rohan', message: 'Have fun!' } });
  assert.equal(c.status, 201);
  assert.equal(c.json.amountPaise, 200000);
  assert.equal(c.json.keyId, 'rzp_test_abc');
  assert.equal(orders.at(-1).amount, 200000);
  assert.equal(orders.at(-1).transfers, undefined, 'platform mode sends no transfers');

  // not counted until verified
  assert.equal((await call('GET', `/api/r/${reg.slug}`)).json.totalRaised, 0);

  // forged signature rejected
  const bad = await call('POST', `/api/r/${reg.slug}/verify`, {
    body: { contributionId: c.json.contributionId, razorpay_payment_id: 'pay_1', razorpay_signature: 'f'.repeat(64) },
  });
  assert.equal(bad.status, 400);
  assert.equal((await call('GET', `/api/r/${reg.slug}`)).json.totalRaised, 0);

  // correct signature accepted
  const good = await call('POST', `/api/r/${reg.slug}/verify`, {
    body: { contributionId: c.json.contributionId, razorpay_payment_id: 'pay_1', razorpay_signature: sign(c.json.orderId, 'pay_1') },
  });
  assert.equal(good.status, 200);

  const after1 = (await call('GET', `/api/r/${reg.slug}`)).json;
  assert.equal(after1.totalRaised, 2000);
  assert.equal(after1.dreams[0].raised, 2000);
  assert.equal(after1.contributions[0].guest, 'Rohan');
  assert.equal(after1.contributions[0].message, 'Have fun!');

  // replaying the same success callback must not double count
  await call('POST', `/api/r/${reg.slug}/verify`, {
    body: { contributionId: c.json.contributionId, razorpay_payment_id: 'pay_1', razorpay_signature: sign(c.json.orderId, 'pay_1') },
  });
  assert.equal((await call('GET', `/api/r/${reg.slug}`)).json.totalRaised, 2000);
});

test('webhook marks paid when the guest closed the tab; bad signature and wrong amount are ignored', async () => {
  const { json: reg } = await createRegistry();
  const dreamId = (await call('GET', `/api/r/${reg.slug}`)).json.dreams[1].id;
  const c = (await call('POST', `/api/r/${reg.slug}/contribute`, { body: { dreamId, amount: 500, guest: 'Isha' } })).json;

  const payload = (amountPaise) =>
    JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_w1', order_id: c.orderId, amount: amountPaise } } } });
  const hmac = (body, secret = WEBHOOK_SECRET) => crypto.createHmac('sha256', secret).update(body).digest('hex');

  const unsigned = await call('POST', '/api/webhook/razorpay', { raw: payload(50000), headers: { 'x-razorpay-signature': hmac(payload(50000), 'wrong') } });
  assert.equal(unsigned.status, 400);

  const wrongAmount = payload(10000);
  await call('POST', '/api/webhook/razorpay', { raw: wrongAmount, headers: { 'x-razorpay-signature': hmac(wrongAmount) } });
  assert.equal((await call('GET', `/api/r/${reg.slug}`)).json.totalRaised, 0);

  const ok = payload(50000);
  const res = await call('POST', '/api/webhook/razorpay', { raw: ok, headers: { 'x-razorpay-signature': hmac(ok) } });
  assert.equal(res.status, 200);
  assert.equal((await call('GET', `/api/r/${reg.slug}`)).json.totalRaised, 500);
});

test('direct UPI: stays pending until owner confirms; owner can reject', async () => {
  const { json: reg } = await createRegistry();
  const dreamId = (await call('GET', `/api/r/${reg.slug}`)).json.dreams[2].id;

  const a = await call('POST', `/api/r/${reg.slug}/contribute-upi`, { body: { dreamId, amount: 1000, guest: 'Kabir' } });
  const b = await call('POST', `/api/r/${reg.slug}/contribute-upi`, { body: { dreamId, amount: 700, guest: 'Spammer' } });
  assert.equal(a.status, 201);
  assert.match(a.json.upiLink, /^upi:\/\/pay\?pa=aarav%40okhdfcbank&pn=Aarav&am=1000\.00&cu=INR&tn=/);

  assert.equal((await call('GET', `/api/r/${reg.slug}`)).json.totalRaised, 0);

  const owner = (await call('GET', `/api/r/${reg.slug}/owner`, { token: reg.ownerToken })).json;
  assert.equal(owner.pending.length, 2);

  // guests cannot confirm
  assert.equal((await call('POST', `/api/r/${reg.slug}/contributions/${a.json.contributionId}/confirm`)).status, 401);

  const conf = await call('POST', `/api/r/${reg.slug}/contributions/${a.json.contributionId}/confirm`, { token: reg.ownerToken });
  assert.equal(conf.json.totalRaised, 1000);
  const rej = await call('POST', `/api/r/${reg.slug}/contributions/${b.json.contributionId}/reject`, { token: reg.ownerToken });
  assert.equal(rej.json.pending.length, 0);
  assert.equal(rej.json.totalRaised, 1000);
});

test('a dream with paid gifts cannot be deleted', async () => {
  const { json: reg } = await createRegistry();
  const dreamId = (await call('GET', `/api/r/${reg.slug}`)).json.dreams[0].id;
  const c = (await call('POST', `/api/r/${reg.slug}/contribute-upi`, { body: { dreamId, amount: 100, guest: 'X' } })).json;
  await call('POST', `/api/r/${reg.slug}/contributions/${c.contributionId}/confirm`, { token: reg.ownerToken });
  const del = await call('DELETE', `/api/r/${reg.slug}/dreams/${dreamId}`, { token: reg.ownerToken });
  assert.equal(del.status, 409);
});

test('input validation on contributions', async () => {
  const { json: reg } = await createRegistry();
  const dreamId = (await call('GET', `/api/r/${reg.slug}`)).json.dreams[0].id;
  const post = (body) => call('POST', `/api/r/${reg.slug}/contribute-upi`, { body });
  assert.equal((await post({ dreamId, amount: 0, guest: 'A' })).status, 400);
  assert.equal((await post({ dreamId, amount: 100001, guest: 'A' })).status, 400);
  assert.equal((await post({ dreamId, amount: 12.5, guest: 'A' })).status, 400);
  assert.equal((await post({ dreamId, amount: 100, guest: '' })).status, 400);
  assert.equal((await post({ dreamId: 999999, amount: 100, guest: 'A' })).status, 400);
});

test('guest page escapes the couple name (no HTML injection) and 404s unknown slugs', async () => {
  const { json: reg } = await createRegistry({ partner1: '<script>alert(1)</script>' });
  const page = await call('GET', `/r/${reg.slug}`);
  assert.equal(page.status, 200);
  assert.ok(!page.text.includes('<script>alert(1)</script>'));
  assert.ok(page.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.equal((await call('GET', '/r/doesnotexist')).status, 404);
  for (const p of ['/', '/privacy', '/delete-account']) assert.equal((await call('GET', p)).status, 200);
});

test('delete wishlist removes everything', async () => {
  const { json: reg } = await createRegistry();
  assert.equal((await call('DELETE', `/api/r/${reg.slug}`)).status, 401);
  assert.equal((await call('DELETE', `/api/r/${reg.slug}`, { token: reg.ownerToken })).status, 200);
  assert.equal((await call('GET', `/api/r/${reg.slug}`)).status, 404);
});

test('admin: disabled without key, attaches linked account with key, summary works', async () => {
  const { json: reg } = await createRegistry();
  assert.equal((await call('POST', `/api/admin/registries/${reg.slug}/linked-account`, { body: { account: 'acc_123' } })).status, 401);
  const h = { 'x-admin-key': ADMIN_KEY };
  assert.equal((await call('POST', `/api/admin/registries/${reg.slug}/linked-account`, { body: { account: 'bad' }, headers: h })).status, 400);
  assert.equal((await call('POST', `/api/admin/registries/${reg.slug}/linked-account`, { body: { account: 'acc_123ABC' }, headers: h })).status, 200);
  const s = await call('GET', '/api/admin/summary', { headers: h });
  assert.equal(s.status, 200);
  assert.ok(s.json.some((r) => r.slug === reg.slug && r.linkedAccount === 'acc_123ABC'));
});

test('route mode: online payments only for linked couples, transfers sent with fee deducted', async () => {
  const s2 = await startApp({ settlementMode: 'route' });
  const prev = base;
  base = `http://127.0.0.1:${s2.address().port}`;
  try {
    const { json: reg } = await createRegistry();
    const pub = (await call('GET', `/api/r/${reg.slug}`)).json;
    assert.equal(pub.onlinePayments, false);
    const dreamId = pub.dreams[0].id;
    assert.equal((await call('POST', `/api/r/${reg.slug}/contribute`, { body: { dreamId, amount: 1000, guest: 'A' } })).status, 409);

    await call('POST', `/api/admin/registries/${reg.slug}/linked-account`, { body: { account: 'acc_LINK1' }, headers: { 'x-admin-key': ADMIN_KEY } });
    assert.equal((await call('GET', `/api/r/${reg.slug}`)).json.onlinePayments, true);
    const c = await call('POST', `/api/r/${reg.slug}/contribute`, { body: { dreamId, amount: 1000, guest: 'A' } });
    assert.equal(c.status, 201);
    const t = orders.at(-1).transfers[0];
    assert.equal(t.account, 'acc_LINK1');
    assert.equal(t.amount, 98000); // 100000 paise minus 2% fee
  } finally {
    s2.close();
    base = prev;
  }
});

test('no gateway configured: online payments off, UPI direct still works', async () => {
  const s3 = await startApp({ withGateway: false });
  const prev = base;
  base = `http://127.0.0.1:${s3.address().port}`;
  try {
    const { json: reg } = await createRegistry();
    const pub = (await call('GET', `/api/r/${reg.slug}`)).json;
    assert.equal(pub.onlinePayments, false);
    assert.equal((await call('POST', `/api/r/${reg.slug}/contribute`, { body: { dreamId: pub.dreams[0].id, amount: 100, guest: 'A' } })).status, 409);
    assert.equal((await call('POST', `/api/r/${reg.slug}/contribute-upi`, { body: { dreamId: pub.dreams[0].id, amount: 100, guest: 'A' } })).status, 201);
  } finally {
    s3.close();
    base = prev;
  }
});

test('rate limiter throttles abusive wishlist creation', async () => {
  const app = createApp({ db: openDb(':memory:'), gateway: null, config: {} });
  const s = await new Promise((r) => { const x = app.listen(0, () => r(x)); });
  const prev = base;
  base = `http://127.0.0.1:${s.address().port}`;
  try {
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await createRegistry()).status);
    assert.equal(codes.filter((c) => c === 201).length, 10);
    assert.equal(codes.at(-1), 429);
  } finally { s.close(); base = prev; }
});
