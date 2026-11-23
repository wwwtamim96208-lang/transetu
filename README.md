# ত্রাণসেতু (TranSetu)

**Track:** World Problem Solver
**Declared advanced challenges:** A04 Offline-First Functionality · A02 Intelligent Decisions & Optimization

## The problem

During floods in Bangladesh, the government, NGOs and volunteer groups distribute relief separately, and none of them can see the others' records. As a result, some families receive the same relief repeatedly while the most vulnerable families (elderly, disabled, sick, remote) receive nothing. Field areas often have no internet.

TranSetu puts every organisation's distributions into **one ledger**. It:

- detects duplicate families,
- warns before repeat relief,
- marks a delivery as done only after confirmation,
- shows who is still unreached and what is in short supply,
- works offline in the field.

**Who uses it:**

- Upazila administration (admin)
- NGO coordinators
- Field volunteers

Affected families interact only through a printed token card.

## Status

| Part | State |
|---|---|
| Household registry: CRUD, 3-tier duplicate check, roles, audit log | ✅ Day 1 |
| Offline PWA, sync, conflict review | ⏳ Day 2 |
| Distribution state machine, cooldown, ledger, token confirmation | ⏳ Day 3 |
| Priority allocation (A02), gap dashboard | ⏳ Day 3 |

## Tech stack

Next.js 15 (App Router, TypeScript) · PostgreSQL · Prisma 6 · Zod · bcryptjs · (Day 2: Dexie/IndexedDB + service worker)

## Setup

```bash
git clone <repo> && cd transetu
npm install
cp .env.example .env        # then edit: DATABASE_URL, DIRECT_URL, two secrets
#   openssl rand -hex 32    -> use for NID_HASH_SECRET and CARD_TOKEN_SECRET
npm run db:push             # create tables
npm run db:seed             # demo data (wipes the DB)
npm run dev                 # http://localhost:3000
npm test                    # domain logic unit tests
```

**Deploy (Vercel + Neon):**

1. Create a Neon database. Put its pooled URL in `DATABASE_URL` and its direct URL in `DIRECT_URL`.
2. Import the repo in Vercel and add the same four env vars.
3. Run `npm run db:push && npm run db:seed` once from your machine against the Neon URLs.

## Demo accounts

All demo accounts use the password `Demo@1234`, which can be changed via `SEED_PASSWORD`.

| Role | Email | Scope |
|---|---|---|
| Admin | admin@demo.bd | everything, can delete |
| Coordinator | coord.alo@demo.bd | all households, edits own org's |
| Coordinator | coord.setu@demo.bd | all households, edits own org's |
| Volunteer | vol1@demo.bd, vol2@demo.bd | Tahirpur Sadar union only |
| Volunteer | vol3@demo.bd | Fenarbak union only |

## Architecture

```
src/
  lib/domain/        pure logic, no framework: runs on server, in browser (offline) and in tests
    normalize.ts     Bangla/English name keys, BD phone + NID normalisation
    duplicate.ts     3-tier duplicate policy
    priority.ts      explainable priority score
    cooldown.ts      repeat-relief window
    token.ts         offline-verifiable token-card codes, NID hashing
  lib/               server: auth (sessions), permissions, validation, household service, audit
  app/api/           thin route handlers -> lib services
  app/               pages (server components) + components/ (client forms)
prisma/              schema (full, incl. later-phase tables) + deterministic seed
tests/               node:test unit tests for lib/domain
```

## Key rules

### Duplicate detection (three tiers)

| Match | Level | Effect |
|---|---|---|
| Same NID (hashed) | BLOCK | Registration refused. A DB unique index also stops two simultaneous submits. |
| Same phone | FLAG | Allowed only after confirming "different family" with a reason of at least 10 characters. A review item is created. |
| Similar head name in the same ward | REVIEW | Allowed. A review item is created for a coordinator. |

Names are compared with a phonetic key. Honorifics (মোঃ, Md., মোছাঃ, Mst…) are dropped, vowels are dropped, and Bangla and Latin consonants are mapped to the same class. As a result, `মোঃ রহিম উদ্দিন`, `Md. Rahim Uddin` and `রহীম উদ্দিন` all match. One-letter slips are tolerated on longer names.

### Security

- **Passwords and sessions.** Passwords are stored as bcrypt hashes. Session tokens are random and only their SHA-256 hash is stored. The session cookie is `httpOnly`, `SameSite=Lax`, and `Secure` in production, and expires after 12 hours.
- **Login protection.** The account locks for 15 minutes after 5 failed logins. Failed logins are audit-logged.
- **CSRF and redirects.** Mutating API calls are rejected when the `Origin` header is from another site. The `?next=` parameter on login only accepts internal paths, so it can't be used as an open redirect.
- **NID handling.** The raw NID is never stored, only an HMAC of it plus the last 4 digits for display.
- **Token-card codes.** Codes are derived on the server with HMAC. Devices only ever hold a salted PBKDF2 hash of each code, so codes can be verified offline without being revealed.
- **Scope checks.** Out-of-scope records return `404`, not `403`, so a user can't tell whether a record exists. Duplicate warnings about out-of-scope households show no link.

### Permission matrix

| | Admin | Coordinator | Volunteer |
|---|---|---|---|
| View households | all | all | own union |
| Register | yes | yes | own union's wards |
| Edit | all | own org's | ones they created |
| Delete (soft, with reason) | yes | no | no |

### Data integrity

- **Optimistic locking.** Every household has a `version`. Updates use `WHERE id = ? AND version = ?`. If two people edit at once, the second save gets `409 VERSION_CONFLICT` instead of silently overwriting the first.
- **Idempotent create.** The form generates a UUID when it loads. A double-click or a network retry returns the same record (`200`) instead of creating a second one. Two identical submits racing each other are resolved by the primary key.
- **Soft delete.** Deleting a household sets a timestamp and a reason; the ledger history stays.
- **Audit log.** Every change is audit-logged in the same transaction, with before and after values.

## Configurable numbers (seed)

| Category | Unit | Need basis | Need / day | Cooldown |
|---|---|---|---|---|
| FOOD | packet | per household | 1/7 | 7 days |
| WATER | litre | per person | 3 | 3 days |
| MEDICINE | kit | per household | 1/14 | 14 days |

**Priority weights** are defined in `src/lib/domain/priority.ts`:

- 2 per member, counting at most 10 members
- elderly (60+): +10 each, capped at 20
- disability: +12 each, capped at 24
- chronic illness: +8 each, capped at 16
- child under 5: +6 each, capped at 18
- pregnant: +10 each, capped at 20
- female-headed household: +10
- damage: 0, 8, 15 or 25 (none, partial, severe, total)
- never received this category: +25; otherwise +1 per day since the last delivery, capped at 20

## Demo cases (Day 1)

Log in as `coord.alo@demo.bd` and open **New household**. Select **তাহিরপুর সদর ওয়ার্ড ১** as the ward, then try:

1. Head name **Md. Rahim Uddin**. A REVIEW warning appears, because `মোঃ রহিম উদ্দিন` is already registered in that ward.
2. Phone **01711000111**. A FLAG warning appears (রহিমা বেগম uses this phone). Saving requires confirmation and a reason.
3. NID **1990123456**. Registration is BLOCKED.
4. Double-click **Save** or retry after losing connection. Only one record is created.
5. Open the same household in two tabs and edit both. The second save gets a version-conflict message.
6. Log in as `vol3@demo.bd`. Households outside Fenarbak are invisible, and their URLs return 404.

## Limitations and notes

- Area names are a demo setup and should be verified before being shown as official data.
- All seeded people, phones and NIDs are fictional.
- An 8-character card code has limited entropy. PBKDF2 slows brute force on a stolen device but doesn't prevent it. Re-issuing codes (a new code version) is planned.
