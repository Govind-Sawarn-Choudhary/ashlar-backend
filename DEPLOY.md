# Backend deploy (VPS / Xenax Cloud)

## 1. Server setup

```bash
sudo apt update && sudo apt install -y nodejs npm git
git clone <your-repo> && cd Ashlarlawyerhub/backend
npm install
cp .env.example .env
nano .env
```

## 2. Required `.env` for apps to work

| Variable | Purpose |
|----------|---------|
| `PORT` | e.g. `8080` (match Flutter `API_BASE_URL`) |
| `JWT_SECRET` | Strong random string |
| `OTP_MODE` | `staging` until DLT SMS (any phone + `TEMP_OTP_CODE`) |
| `TEMP_OTP_CODE` | e.g. `123456` — shown in server logs when OTP sent |
| `WALLET_TOPUP_MODE` | `staging` for instant wallet credit while testing; `razorpay` for live |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Booking & wallet payments |
| `AGORA_APP_ID` / `AGORA_APP_CERTIFICATE` | Video/voice (optional) |
| `AGORA_CHAT_APP_KEY` | Consult chat (optional) |

Change `ADMIN_PASSWORD` after first login.

## 3. Run

```bash
PORT=8080 npm start
# or
npm install -g pm2
PORT=8080 pm2 start src/index.js --name ashlar-api
pm2 save
```

## 4. Firewall

Open `PORT` (8080) and optionally 443 if using nginx + HTTPS.

## 5. Health check

```bash
curl http://<SERVER_IP>:8080/health
```

## 6. Flutter app

Update `flutter/env.production.json`:

```json
{ "API_BASE_URL": "http://<SERVER_IP>:8080" }
```

Rebuild APK after deploy.

## 7. Data

SQLite DB and `uploads/` live in `backend/`. Back up before redeploy:

```bash
cp data.sqlite uploads/ ~/backup/
```