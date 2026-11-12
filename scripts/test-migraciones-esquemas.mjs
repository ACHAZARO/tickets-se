// Falla si una migracion de Tickets toca los esquemas de otros sistemas (pos, bot_whatsapp).
// Uso: node scripts/test-migraciones-esquemas.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
const re = /\b(pos|bot_whatsapp)\s*\.|\bschema\s+"?(pos|bot_whatsapp)\b/i;
const malas = readdirSync(dir).filter(f => f.endsWith('.sql')).filter(f => {
  const sql = readFileSync(join(dir, f), 'utf8').replace(/--.*$/gm, '');
  return re.test(sql);
});
if (malas.length) { console.error('Migraciones que mencionan pos/bot_whatsapp:', malas); process.exit(1); }
console.log('OK: ninguna migracion de Tickets toca pos ni bot_whatsapp');
