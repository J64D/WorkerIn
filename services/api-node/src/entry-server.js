import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(root, '.env') });

const hasSupabaseConfig = Boolean(
  process.env.SUPABASE_URL &&
  (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY) &&
  (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
);

if (hasSupabaseConfig) {
  await import('./supabase-server.js');
} else {
  console.warn('Supabase ainda não configurado; iniciando o modo de demonstração local.');
  await import('./demo-server.js');
}
