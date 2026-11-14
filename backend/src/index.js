import path from 'node:path';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { razorpayGateway } from './razorpay.js';

const env = process.env;
const dataDir = env.DATA_DIR || path.join(process.cwd(), 'data');
const db = openDb(path.join(dataDir, 'dreamgift.db'));

const keyId = env.RAZORPAY_KEY_ID || '';
const keySecret = env.RAZORPAY_KEY_SECRET || '';
const gateway = keyId && keySecret ? razorpayGateway({ keyId, keySecret }) : null;

const settlementMode = env.SETTLEMENT_MODE === 'platform' ? 'platform' : 'route';

const app = createApp({
  db,
  gateway,
  config: {
    keySecret,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
    settlementMode,
    feePercent: Number(env.PLATFORM_FEE_PERCENT || 0),
    adminKey: env.ADMIN_KEY || '',
    supportEmail: env.SUPPORT_EMAIL || 'support@example.com',
    appName: env.APP_NAME || 'DreamGift',
  },
});

const port = Number(env.PORT || 3000);
app.listen(port, () => {
  console.log(`DreamGift backend on :${port}`);
  console.log(gateway ? `Online payments: Razorpay (${settlementMode} settlement)` : 'Online payments: OFF (UPI direct only)');
  if (gateway && !env.RAZORPAY_WEBHOOK_SECRET) console.warn('WARNING: RAZORPAY_WEBHOOK_SECRET not set; webhooks will be rejected');
  if (!env.ADMIN_KEY) console.warn('Admin endpoints disabled (ADMIN_KEY not set)');
});
