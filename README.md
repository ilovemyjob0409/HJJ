# Tutoring Center Makeup/Reschedule System

A Next.js + Prisma + NextAuth app for managing class leave requests, makeup
classes (insertion or one-on-one), and substitute-teacher requests at a
tutoring center.

## Prerequisites

- Node.js v24 (e.g. via `nvm use v24.18.0`)
- npm

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the example environment file and adjust as needed:

   ```bash
   cp .env.example .env
   ```

   This sets `DATABASE_URL` (a local SQLite file), `NEXTAUTH_SECRET` (replace
   with your own random string for anything beyond local dev), and
   `NEXTAUTH_URL`.

3. Create the database schema and generate the Prisma client:

   ```bash
   npx prisma db push
   npx prisma generate
   ```

4. Seed the database with one demo user per role:

   ```bash
   npm run seed
   ```

   This creates an admin (`admin@example.com`), a teacher
   (`teacher@example.com`), and a student (`student@example.com`), a sample
   class, and a teacher availability window. All seeded accounts use the
   password `password123`.

5. Start the dev server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Tests

```bash
npm test
```

This pushes the schema to a separate `prisma/test.db` and runs the Vitest
suite against it.
