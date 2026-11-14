# DreamGift 💍

**"Stop gifting mixers at Indian weddings."** Couples list their dreams (honeymoon, first home, Japan trip). They share **one link**; guests open it in any browser, pick a dream, and pay by **UPI / card / netbanking**. Progress bars fill up live.

```
DreamGift/
├── backend/   Node 22 + Express + SQLite   → API, guest web page, Razorpay payments, privacy page
├── app/       Android app (Kotlin, Compose) → what the couple installs from Play Store
└── .github/   CI: runs backend tests, builds APK + signed AAB
```

## How it fits together

| Who | What they do | Where |
|---|---|---|
| Couple | Installs the app, enters names + UPI ID, edits dreams, shares the link, watches progress, confirms direct-UPI gifts | Android app |
| Guest | Opens the link (no install, no sign-up), picks a dream + amount, pays | `https://your-domain/r/<code>` |
| Money | **Online:** Razorpay Checkout → Razorpay → (Route) the couple's account. **Direct UPI:** guest's UPI app → couple's UPI ID, couple taps "Received" | Razorpay / UPI |

Payments happen on the web page, not inside the Android app, so the app itself never handles money.

## What has and hasn't been verified

- ✅ Backend: 15 automated tests pass (`cd backend && npm test`): payment-signature verification, webhook, replay/double-count protection, amount tampering, route-mode transfers, auth, validation, rate limiting, HTML-injection escaping. The guest page was also driven in a real browser (pay online, pay via UPI, live progress).
- ⚠️ **Not tested with real Razorpay:** tests use a fake gateway with the real signature code. Do an end-to-end run with Razorpay **test keys** before going live (step 3).
- ⚠️ **Android app was written but not compiled** in the environment that produced this project (its network blocks Google/Maven). The first GitHub build is the first compile. If it fails, send the error log and it'll be a quick fix.

---

## Step 1: Deploy the backend (≈15 min)

SQLite needs a persistent disk, so pick a host that offers one (Render paid instance + disk, Fly.io volume, Railway volume; check current pricing).

**Render (easiest):** push this repo to GitHub → Render → *New → Blueprint* → select the repo (`render.yaml` is included) → fill the env vars (below) → deploy. You get `https://dreamgift-xxxx.onrender.com`; attach your own domain if you have one.

**Fly.io:** see the header of `backend/fly.toml`.

Environment variables (full list in `backend/.env.example`):

| Variable | Notes |
|---|---|
| `SUPPORT_EMAIL` | **Required for Play.** Shown on privacy + delete pages |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | From Razorpay Dashboard. Start with **Test** keys. Leave blank = UPI-direct only |
| `RAZORPAY_WEBHOOK_SECRET` | Any long random string; reuse it in step 3 |
| `SETTLEMENT_MODE` | `route` (default, recommended) or `platform`, see "Money & compliance" |
| `PLATFORM_FEE_PERCENT` | Optional fee kept on each online gift in `route` mode. Default 0 |
| `ADMIN_KEY` | Long random string. Protects `/api/admin/*` |

Check: open `https://your-domain/` and `https://your-domain/privacy`.

## Step 2: Try the app on your phone

1. Push the repo to GitHub. In **Settings → Secrets and variables → Actions → Variables**, add `BACKEND_URL` = `https://your-domain` (no trailing slash).
2. **Actions → Build → Run workflow.** Download **DreamGift-debug-apk**, unzip, copy `app-debug.apk` to your phone, tap to install.
3. Create a wishlist in the app, tap **Share**, open the link on another phone and send a ₹1 gift.

(Or open the folder in Android Studio; set `-PbackendUrl=...` or use the emulator default `http://10.0.2.2:3000` with the backend running locally.)

## Step 3: Turn on online payments (Razorpay)

1. Create a Razorpay account, finish KYC, use **Test mode** first.
2. **Dashboard → Webhooks → Add:** URL `https://your-domain/api/webhook/razorpay`, secret = your `RAZORPAY_WEBHOOK_SECRET`, events **`payment.captured`** and **`order.paid`**.
3. Put the test key id/secret in the host's env vars and redeploy. The guest page now shows **"Pay securely"** (it only appears when payments are available for that couple).
4. Pay with Razorpay's [test UPI/card details](https://razorpay.com/docs/payments/payments/test-card-details/); the gift should appear on the page and in the app within seconds.
5. Only then switch to Live keys.

### Money & compliance (please read)

Collecting money on behalf of other people is regulated in India. The two modes:

- **`route` (recommended):** uses Razorpay **Route**: each couple is onboarded as a *linked account* (their KYC, their bank account), and every payment is split straight to them, with your optional fee deducted. You must have Route enabled by Razorpay. After creating the linked account in the Razorpay dashboard, enable it for a couple with:
  ```bash
  curl -X POST https://your-domain/api/admin/registries/<slug>/linked-account \
       -H "x-admin-key: $ADMIN_KEY" -H "Content-Type: application/json" \
       -d '{"account":"acc_XXXXXXXX"}'
  ```
  Until a couple has a linked account, their page offers **direct UPI only**. Per-couple onboarding is manual in this version.
- **`platform`:** all money lands in *your* Razorpay account and *you* pay couples out (`GET /api/admin/summary` lists totals). Simpler, but you are then holding third-party funds, so get proper legal/accounting advice first.

Direct UPI (guest → couple's UPI ID) needs no gateway and no setup, but the gift only counts once the couple taps **Received** in the app.

I'm not a lawyer or a compliance advisor. Confirm with Razorpay and a professional before charging fees or going live.

## Step 4: Publish on Google Play

### One-time prep
- Pick your own **application ID** (`applicationId` in `app/build.gradle.kts`, currently `com.dreamgift.app`). It can never change after publishing.
- Create a **Google Play Console** developer account (one-time registration fee).
- Create an upload key:
  ```bash
  keytool -genkeypair -v -keystore upload-keystore.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
  base64 -w0 upload-keystore.jks        # macOS: base64 -i upload-keystore.jks
  ```
  Back up the `.jks` and passwords somewhere safe; never commit them.
- GitHub **Secrets** (same page as Variables): `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` (= `upload`), `KEY_PASSWORD`.
- Re-run the workflow. It now also produces **DreamGift-release-aab** (upload this to Play). The release build **refuses to build unless `BACKEND_URL` is an `https://` address**, so you can't ship an app pointing at localhost.

### In Play Console
1. **Create app** → upload the `.aab` to a **Closed testing** track first. New personal developer accounts must run a closed test with a minimum number of testers for a minimum number of days before production access, so check the current numbers in the Console.
2. **Store listing:** use `play-store-assets/icon-512.png` and `feature-graphic-1024x500.png`; add 2+ phone screenshots (take them from the debug app).
3. **Privacy policy URL:** `https://your-domain/privacy`. **Account deletion URL:** `https://your-domain/delete-account` (the app also has Menu → Delete wishlist).
4. **Data safety:** the app collects names, a UPI ID and gift messages (sent to your server), no ads, no analytics, nothing sold. Declare exactly that. Review `backend/public/privacy.html` and edit it to match your real business details.
5. **Financial features / payments declarations:** answer accurately: payments happen on your website via Razorpay; the app itself does not process payments.
6. Content rating questionnaire, target audience (18+), then promote to **Production** and submit for review.

The app targets **API 36**, which satisfies Google Play's current new-app target-level requirement.

Suggested listing text:
> **Short:** Skip the 4th mixer. Gift the couple their dreams.
> **Full:** DreamGift is a wedding wishlist for dreams, not appliances. Couples list what they're really saving for (honeymoon, first home, a trip to Japan) and share one link. Guests chip in any amount with UPI, card or netbanking, no app or sign-up needed, and everyone watches the dreams fill up in real time.

## Run locally

```bash
cd backend && npm install && npm test && npm start      # http://localhost:3000
```
No env vars needed (UPI-direct mode). Add Razorpay test keys to try online payments.

## Things to know / next steps

- Guest links are public: anyone with the link sees names, UPI ID, dreams and confirmed gifts (stated on the privacy page).
- Couples' ownership is a secret token stored on their phone; **uninstalling or switching phones loses access** to that wishlist. Next step: phone-number/Google login.
- Per-couple Razorpay Route onboarding is manual; automating it (Razorpay Route onboarding API) is the natural next feature.
- Refunds/disputes are handled in the Razorpay dashboard; the app doesn't reverse gifts automatically.
- Backup: the entire database is the single file `dreamgift.db` in the data disk; snapshot it.
