# Ashlar Lawyer Hub — Backend

Node.js + Express + SQLite API for lawyer onboarding, auth, and admin review.

## Setup

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Server runs at `http://localhost:3000`.

## Temporary OTP (until DLT license)

Configured in `.env`:

- Phone: `8521429014`
- OTP: `123456`

Only this number can receive OTP for now. Swap `otp.service.js` with MSG91/Twilio when DLT is ready.

## API overview

### Auth
- `POST /api/auth/send-otp` — `{ phone, role: "lawyer" | "user" }`
- `POST /api/auth/verify-otp` — `{ phone, otp, role }` → JWT + `nextRoute`

### Lawyer (Bearer token)
- `GET /api/lawyer/me`
- `PUT /api/lawyer/profile/details`
- `POST /api/lawyer/profile/documents` — multipart `file` + `docType`
- `POST /api/lawyer/profile/documents/complete`
- `PUT /api/lawyer/profile/availability`
- `PUT /api/lawyer/profile/fees`

### Admin
- `POST /api/admin/login` — `{ email, password }`
- `GET /api/admin/stats`
- `GET /api/admin/lawyers?status=pending&search=`
- `GET /api/admin/lawyers/:id`
- `PATCH /api/admin/lawyers/:id/verification` — `{ status, rejectionReason? }`

Default admin: `admin@ashlarlaw.com` / `admin123`

## Lawyer onboarding flow

```
OTP verify → verify_details → upload_documents → select_availability → fee_and_charges → dashboard
```

After fees are saved, `verification_status` is `pending` until admin approves in the React admin panel.
