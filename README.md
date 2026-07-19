# Tutoring Center Makeup/Reschedule System

A Next.js + Prisma + NextAuth app for managing class leave requests, makeup
classes (insertion or one-on-one), and substitute-teacher requests at a
tutoring center.

## Prerequisites

- Node.js v24 (e.g. via `nvm use v24.18.0`)
- npm
- Docker (for a local Postgres instance — see below)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start a local Postgres instance:

   ```bash
   docker compose up -d
   ```

   This runs Postgres 16 on `localhost:5432` (user/password `postgres`),
   persisted in a Docker volume across restarts.

3. Copy the example environment file and adjust as needed:

   ```bash
   cp .env.example .env
   ```

   This sets `DATABASE_URL` (pointing at the local Postgres container),
   `NEXTAUTH_SECRET` (replace with your own random string for anything
   beyond local dev), and `NEXTAUTH_URL`.

4. Create the database schema and generate the Prisma client:

   ```bash
   npx prisma db push
   npx prisma generate
   ```

5. Seed the database with one demo user per role:

   ```bash
   npm run seed
   ```

   This creates an admin (`admin@example.com`), a teacher
   (`teacher@example.com`), and a student (`student@example.com`), a sample
   class, and a teacher availability window. All seeded accounts use the
   password `password123`.

6. Start the dev server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Tests

```bash
npm test
```

This pushes the schema to a separate `tutoring_makeup_system_test` database
on the same local Postgres container (see Setup step 2) and runs the Vitest
suite against it.

## Deploying to Vercel

1. Create a Vercel project from this repo and attach a Vercel Postgres
   database to it (Storage tab) — this auto-sets `DATABASE_URL`.
2. Set `NEXTAUTH_SECRET` (a random string) and `NEXTAUTH_URL` (your
   production URL) as project environment variables.
3. Deploy. `postinstall` runs `prisma generate` automatically on every
   install; the database schema itself is NOT created automatically — run
   `npx prisma db push` once against the production `DATABASE_URL` (e.g. via
   `vercel env pull` + running it locally) before the first real use, then
   `npm run seed` if you want the demo accounts in production too (or skip
   seeding and create real accounts through the admin UI instead).
