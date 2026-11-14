import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCheckoutSignature, verifyWebhookSignature } from './razorpay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const UPI_REGEX = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
const MIN_AMOUNT = 1;
const MAX_AMOUNT = 100000; // rupees per single contribution
const MAX_DREAMS = 20;

const SAMPLE_DREAMS = [
  { emoji: '✈️', title: 'Honeymoon in Europe', target: 300000 },
  { emoji: '🏠', title: 'Down payment for our first home', target: 1000000 },
  { emoji: '🌏', title: 'Trip to Japan', target: 250000 },
];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function cleanStr(v, { max, min = 0, field }) {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (s.length < min) throw new HttpError(400, `${field} is required`);
  if (s.length > max) throw new HttpError(400, `${field} is too long (max ${max})`);
  return s;
}

function cleanInt(v, { min, max, field }) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${field} must be a whole number between ${min} and ${max}`);
  }
  return n;
}

function newSlug() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function makeLimiter(scale = 1) {
  const hits = new Map();
  return (name, baseMax, windowMs) => (req, _res, next) => {
    const max = baseMax * scale;
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) return next(new HttpError(429, 'Too many requests, please slow down'));
    next();
  };
}

/**
 * @param {object} deps
 * @param {import('node:sqlite').DatabaseSync} deps.db
 * @param {{keyId:string, createOrder:Function}|null} deps.gateway   Razorpay client, or null (UPI-only mode)
 * @param {object} deps.config
 */
export function createApp({ db, gateway, config }) {
  const cfg = {
    keySecret: '',
    webhookSecret: '',
    settlementMode: 'route', // 'route' = each couple has a Razorpay linked account; 'platform' = money lands in your account
    feePercent: 0,
    rateLimitScale: 1,
    adminKey: '',
    supportEmail: 'support@example.com',
    appName: 'DreamGift',
    ...config,
  };

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  const limit = makeLimiter(cfg.rateLimitScale);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use(
    express.json({
      limit: '20kb',
      verify: (req, _res, buf) => {
        req.rawBody = buf; // needed for webhook signature verification
      },
    })
  );

  /* ------------------------------ helpers ------------------------------ */

  const q = (sql) => db.prepare(sql);

  const getRegistry = (slug) => q('SELECT * FROM registries WHERE slug = ?').get(String(slug));

  function loadRegistryOr404(req, _res, next) {
    const reg = getRegistry(req.params.slug);
    if (!reg) return next(new HttpError(404, 'Wishlist not found'));
    req.reg = reg;
    next();
  }

  function ownerOnly(req, _res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const a = Buffer.from(sha256(token));
    const b = Buffer.from(req.reg.token_hash);
    if (!token || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return next(new HttpError(401, 'Not authorised'));
    }
    next();
  }

  const onlineAvailable = (reg) =>
    Boolean(gateway) && (cfg.settlementMode === 'platform' || Boolean(reg.linked_account));

  function dreamsWithProgress(regId) {
    return q(
      `SELECT d.id, d.emoji, d.title, d.target,
              COALESCE((SELECT SUM(c.amount) FROM contributions c
                        WHERE c.dream_id = d.id AND c.status = 'paid'), 0) AS raised
         FROM dreams d WHERE d.registry_id = ? ORDER BY d.position, d.id`
    ).all(regId);
  }

  function view(reg, { owner }) {
    const dreams = dreamsWithProgress(reg.id).map((d) => ({ ...d }));
    const contributions = q(
      `SELECT id, dream_id AS dreamId, guest, amount, message, method, created_at AS createdAt
         FROM contributions WHERE registry_id = ? AND status = 'paid' ORDER BY id DESC LIMIT 100`
    )
      .all(reg.id)
      .map((c) => ({ ...c }));
    const out = {
      slug: reg.slug,
      partner1: reg.partner1,
      partner2: reg.partner2,
      coupleName: reg.partner2 ? `${reg.partner1} & ${reg.partner2}` : reg.partner1,
      upiId: reg.upi_id,
      onlinePayments: onlineAvailable(reg),
      dreams,
      totalRaised: dreams.reduce((s, d) => s + d.raised, 0),
      totalGoal: dreams.reduce((s, d) => s + d.target, 0),
      contributions,
    };
    if (owner) {
      out.pending = q(
        `SELECT id, dream_id AS dreamId, guest, amount, message, created_at AS createdAt
           FROM contributions WHERE registry_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 100`
      )
        .all(reg.id)
        .map((c) => ({ ...c }));
    }
    return out;
  }

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  function markPaid({ contributionId, orderId, paymentId }) {
    // Idempotent: only transitions created/pending -> paid.
    const r = q(
      `UPDATE contributions SET status = 'paid', payment_id = ?
        WHERE id = ? AND order_id = ? AND status IN ('created')`
    ).run(paymentId, contributionId, orderId);
    return r.changes > 0;
  }

  function upiLink(reg, amount, dreamTitle) {
    const enc = encodeURIComponent;
    const note = `Wedding gift - ${dreamTitle}`.slice(0, 45);
    return `upi://pay?pa=${enc(reg.upi_id)}&pn=${enc(reg.partner1)}&am=${amount}.00&cu=INR&tn=${enc(note)}`;
  }

  /* --------------------------- public pages --------------------------- */

  const readPage = (name) =>
    fs
      .readFileSync(path.join(PUBLIC_DIR, name), 'utf8')
      .replaceAll('{{SUPPORT_EMAIL}}', esc(cfg.supportEmail))
      .replaceAll('{{APP_NAME}}', esc(cfg.appName));

  const staticPages = { '/': 'index.html', '/privacy': 'privacy.html', '/delete-account': 'delete-account.html' };
  for (const [route, file] of Object.entries(staticPages)) {
    app.get(route, (_req, res) => res.type('html').send(readPage(file)));
  }

  app.get('/r/:slug', (req, res) => {
    const reg = getRegistry(req.params.slug);
    if (!reg) return res.status(404).type('html').send(readPage('not-found.html'));
    const couple = reg.partner2 ? `${reg.partner1} & ${reg.partner2}` : reg.partner1;
    const html = readPage('guest.html')
      .replaceAll('{{COUPLE}}', esc(couple))
      .replaceAll('{{SLUG}}', esc(reg.slug));
    res.type('html').send(html);
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  /* ------------------------------ API ------------------------------ */

  // Create a wishlist (couple). Returns a secret owner token, shown once; the app stores it.
  app.post(
    '/api/registries',
    limit('create', 10, 60 * 60 * 1000),
    wrap((req, res) => {
      const partner1 = cleanStr(req.body.partner1, { max: 40, min: 1, field: 'Your name' });
      const partner2 = cleanStr(req.body.partner2 ?? '', { max: 40, field: "Partner's name" });
      const upiId = cleanStr(req.body.upiId, { max: 100, min: 1, field: 'UPI ID' });
      if (!UPI_REGEX.test(upiId)) throw new HttpError(400, "That doesn't look like a valid UPI ID");

      const token = crypto.randomBytes(32).toString('hex');
      let slug = newSlug();
      for (let i = 0; i < 5 && getRegistry(slug); i++) slug = newSlug();

      const info = q(
        'INSERT INTO registries (slug, token_hash, partner1, partner2, upi_id, created_at) VALUES (?,?,?,?,?,?)'
      ).run(slug, sha256(token), partner1, partner2, upiId, Date.now());
      const insert = q('INSERT INTO dreams (registry_id, emoji, title, target, position) VALUES (?,?,?,?,?)');
      SAMPLE_DREAMS.forEach((d, i) => insert.run(info.lastInsertRowid, d.emoji, d.title, d.target, i));

      res.status(201).json({ slug, ownerToken: token });
    })
  );

  // Public view (guests)
  app.get('/api/r/:slug', loadRegistryOr404, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(view(req.reg, { owner: false }));
  });

  // Owner view (adds pending UPI confirmations)
  app.get('/api/r/:slug/owner', loadRegistryOr404, ownerOnly, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(view(req.reg, { owner: true }));
  });

  app.put(
    '/api/r/:slug',
    loadRegistryOr404,
    ownerOnly,
    wrap((req, res) => {
      const partner1 = cleanStr(req.body.partner1, { max: 40, min: 1, field: 'Your name' });
      const partner2 = cleanStr(req.body.partner2 ?? '', { max: 40, field: "Partner's name" });
      const upiId = cleanStr(req.body.upiId, { max: 100, min: 1, field: 'UPI ID' });
      if (!UPI_REGEX.test(upiId)) throw new HttpError(400, "That doesn't look like a valid UPI ID");
      q('UPDATE registries SET partner1=?, partner2=?, upi_id=? WHERE id=?').run(partner1, partner2, upiId, req.reg.id);
      res.json(view(getRegistry(req.reg.slug), { owner: true }));
    })
  );

  // Account deletion (required by Google Play for apps that create accounts)
  app.delete('/api/r/:slug', loadRegistryOr404, ownerOnly, (req, res) => {
    q('DELETE FROM registries WHERE id = ?').run(req.reg.id);
    res.json({ deleted: true });
  });

  /* ----- dreams ----- */

  function dreamFields(body) {
    return {
      emoji: cleanStr(body.emoji ?? '✨', { max: 8, min: 1, field: 'Emoji' }),
      title: cleanStr(body.title, { max: 60, min: 1, field: 'Title' }),
      target: cleanInt(body.target, { min: 100, max: 100000000, field: 'Target amount' }),
    };
  }

  app.post(
    '/api/r/:slug/dreams',
    loadRegistryOr404,
    ownerOnly,
    wrap((req, res) => {
      const f = dreamFields(req.body);
      const count = q('SELECT COUNT(*) AS n FROM dreams WHERE registry_id = ?').get(req.reg.id).n;
      if (count >= MAX_DREAMS) throw new HttpError(400, `You can have at most ${MAX_DREAMS} dreams`);
      q('INSERT INTO dreams (registry_id, emoji, title, target, position) VALUES (?,?,?,?,?)').run(
        req.reg.id, f.emoji, f.title, f.target, count
      );
      res.status(201).json(view(req.reg, { owner: true }));
    })
  );

  function loadDream(req) {
    const dream = q('SELECT * FROM dreams WHERE id = ? AND registry_id = ?').get(Number(req.params.id), req.reg.id);
    if (!dream) throw new HttpError(404, 'Dream not found');
    return dream;
  }

  app.put(
    '/api/r/:slug/dreams/:id',
    loadRegistryOr404,
    ownerOnly,
    wrap((req, res) => {
      const dream = loadDream(req);
      const f = dreamFields(req.body);
      q('UPDATE dreams SET emoji=?, title=?, target=? WHERE id=?').run(f.emoji, f.title, f.target, dream.id);
      res.json(view(req.reg, { owner: true }));
    })
  );

  app.delete(
    '/api/r/:slug/dreams/:id',
    loadRegistryOr404,
    ownerOnly,
    wrap((req, res) => {
      const dream = loadDream(req);
      const paid = q("SELECT COUNT(*) AS n FROM contributions WHERE dream_id = ? AND status = 'paid'").get(dream.id).n;
      if (paid > 0) {
        throw new HttpError(409, 'This dream already has gifts, so it cannot be deleted. Edit it instead.');
      }
      q('DELETE FROM dreams WHERE id = ?').run(dream.id);
      res.json(view(req.reg, { owner: true }));
    })
  );

  /* ----- contributing (guests) ----- */

  function readContribution(req) {
    const dream = q('SELECT * FROM dreams WHERE id = ? AND registry_id = ?').get(Number(req.body.dreamId), req.reg.id);
    if (!dream) throw new HttpError(400, 'Please choose one of the dreams');
    return {
      dream,
      amount: cleanInt(req.body.amount, { min: MIN_AMOUNT, max: MAX_AMOUNT, field: 'Amount' }),
      guest: cleanStr(req.body.guest, { max: 60, min: 1, field: 'Your name' }),
      message: cleanStr(req.body.message ?? '', { max: 200, field: 'Message' }),
    };
  }

  // 1) Online payment: create a Razorpay order; the browser then opens Razorpay Checkout.
  app.post(
    '/api/r/:slug/contribute',
    limit('contribute', 30, 10 * 60 * 1000),
    loadRegistryOr404,
    wrap(async (req, res) => {
      if (!onlineAvailable(req.reg)) throw new HttpError(409, 'Online payment is not enabled for this wishlist');
      const c = readContribution(req);
      const amountPaise = c.amount * 100;

      const body = {
        amount: amountPaise,
        currency: 'INR',
        receipt: `dg_${req.reg.id}_${Date.now()}`.slice(0, 40),
        notes: { slug: req.reg.slug, dream: c.dream.title.slice(0, 50), guest: c.guest.slice(0, 50) },
      };
      if (cfg.settlementMode === 'route') {
        const fee = Math.floor((amountPaise * cfg.feePercent) / 100);
        body.transfers = [
          {
            account: req.reg.linked_account,
            amount: amountPaise - fee,
            currency: 'INR',
            notes: { slug: req.reg.slug },
            on_hold: 0,
          },
        ];
      }
      const order = await gateway.createOrder(body);

      const info = q(
        `INSERT INTO contributions (registry_id, dream_id, guest, amount, message, method, status, order_id, created_at)
         VALUES (?,?,?,?,?,'razorpay','created',?,?)`
      ).run(req.reg.id, c.dream.id, c.guest, c.amount, c.message, order.id, Date.now());

      res.status(201).json({
        contributionId: Number(info.lastInsertRowid),
        orderId: order.id,
        keyId: gateway.keyId,
        amountPaise,
        coupleName: req.reg.partner2 ? `${req.reg.partner1} & ${req.reg.partner2}` : req.reg.partner1,
        dreamTitle: c.dream.title,
      });
    })
  );

  // 2) Checkout success callback from the browser: verify signature, mark paid.
  app.post(
    '/api/r/:slug/verify',
    limit('verify', 60, 10 * 60 * 1000),
    loadRegistryOr404,
    wrap((req, res) => {
      const contributionId = Number(req.body.contributionId);
      const row = q(
        'SELECT * FROM contributions WHERE id = ? AND registry_id = ? AND method = ?'
      ).get(contributionId, req.reg.id, 'razorpay');
      if (!row) throw new HttpError(404, 'Contribution not found');

      const ok = verifyCheckoutSignature({
        orderId: row.order_id,
        paymentId: String(req.body.razorpay_payment_id || ''),
        signature: String(req.body.razorpay_signature || ''),
        keySecret: cfg.keySecret,
      });
      if (!ok) throw new HttpError(400, 'Payment could not be verified');

      markPaid({ contributionId: row.id, orderId: row.order_id, paymentId: String(req.body.razorpay_payment_id) });
      res.json({ status: 'paid' });
    })
  );

  // Razorpay webhook: the source of truth if the guest closes the tab right after paying.
  app.post('/api/webhook/razorpay', (req, res) => {
    const ok = verifyWebhookSignature({
      rawBody: req.rawBody,
      signature: req.get('x-razorpay-signature'),
      webhookSecret: cfg.webhookSecret,
    });
    if (!ok) return res.status(400).json({ error: 'bad signature' });

    const event = req.body?.event;
    if (event === 'payment.captured' || event === 'order.paid') {
      const payment = req.body?.payload?.payment?.entity;
      const orderId = payment?.order_id || req.body?.payload?.order?.entity?.id;
      if (orderId && payment?.id) {
        const row = q("SELECT * FROM contributions WHERE order_id = ? AND status = 'created'").get(orderId);
        // amount check guards against an order being paid for a different amount
        if (row && Number(payment.amount) === row.amount * 100) {
          markPaid({ contributionId: row.id, orderId, paymentId: payment.id });
        }
      }
    }
    res.json({ received: true });
  });

  // 3) Direct UPI: no gateway. Guest pays the couple's UPI ID from their own UPI app;
  //    the gift stays "pending" until the couple confirms they received it.
  app.post(
    '/api/r/:slug/contribute-upi',
    limit('contribute-upi', 30, 10 * 60 * 1000),
    loadRegistryOr404,
    wrap((req, res) => {
      const c = readContribution(req);
      const info = q(
        `INSERT INTO contributions (registry_id, dream_id, guest, amount, message, method, status, created_at)
         VALUES (?,?,?,?,?,'upi_direct','pending',?)`
      ).run(req.reg.id, c.dream.id, c.guest, c.amount, c.message, Date.now());
      res.status(201).json({
        contributionId: Number(info.lastInsertRowid),
        upiLink: upiLink(req.reg, c.amount, c.dream.title),
        upiId: req.reg.upi_id,
      });
    })
  );

  app.post('/api/r/:slug/contributions/:id/confirm', loadRegistryOr404, ownerOnly, (req, res) => {
    const r = q("UPDATE contributions SET status='paid' WHERE id=? AND registry_id=? AND status='pending'").run(
      Number(req.params.id), req.reg.id
    );
    if (!r.changes) throw new HttpError(404, 'Nothing to confirm');
    res.json(view(req.reg, { owner: true }));
  });

  app.post('/api/r/:slug/contributions/:id/reject', loadRegistryOr404, ownerOnly, (req, res) => {
    const r = q("DELETE FROM contributions WHERE id=? AND registry_id=? AND status='pending'").run(
      Number(req.params.id), req.reg.id
    );
    if (!r.changes) throw new HttpError(404, 'Nothing to reject');
    res.json(view(req.reg, { owner: true }));
  });

  /* ------------------------------ admin ------------------------------ */

  function adminOnly(req, _res, next) {
    const key = req.get('x-admin-key') || '';
    const a = Buffer.from(sha256(key));
    const b = Buffer.from(sha256(cfg.adminKey || crypto.randomBytes(16).toString('hex')));
    if (!cfg.adminKey || !crypto.timingSafeEqual(a, b)) return next(new HttpError(401, 'Not authorised'));
    next();
  }

  // Attach a Razorpay Route linked account (acc_XXXX) to a couple, enabling online payments for them.
  app.post('/api/admin/registries/:slug/linked-account', adminOnly, loadRegistryOr404, (req, res) => {
    const account = cleanStr(req.body.account, { max: 40, min: 1, field: 'account' });
    if (!/^acc_[A-Za-z0-9]+$/.test(account)) throw new HttpError(400, 'account must look like acc_XXXXXXXX');
    q('UPDATE registries SET linked_account = ? WHERE id = ?').run(account, req.reg.id);
    res.json({ slug: req.reg.slug, linkedAccount: account });
  });

  // Totals per wishlist, useful for payouts in 'platform' settlement mode.
  app.get('/api/admin/summary', adminOnly, (_req, res) => {
    const rows = q(
      `SELECT r.slug, r.partner1, r.partner2, r.upi_id AS upiId, r.linked_account AS linkedAccount,
              COALESCE(SUM(CASE WHEN c.status='paid' AND c.method='razorpay' THEN c.amount END),0) AS onlinePaid,
              COALESCE(SUM(CASE WHEN c.status='paid' AND c.method='upi_direct' THEN c.amount END),0) AS upiConfirmed
         FROM registries r LEFT JOIN contributions c ON c.registry_id = r.id
        GROUP BY r.id ORDER BY r.id DESC`
    ).all();
    res.json(rows.map((r) => ({ ...r })));
  });

  /* ------------------------------ errors ------------------------------ */

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}
