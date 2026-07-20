import 'dotenv/config';
import { defineConfig } from '@prisma/config';

export default defineConfig({
  datasource: {
    // Falls back to Supabase's auto-injected variable when DATABASE_URL
    // isn't set directly (e.g. a fresh Vercel + Supabase integration).
    url: process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING,
  },
});
