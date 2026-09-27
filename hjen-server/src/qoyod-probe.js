// Qoyod connectivity probe — READ-ONLY. Proves the API key works and prints the
// tenant reference ids the integration will use (inventory / category / unit /
// sales account / expense categories). Creates NOTHING. Run before going live:
//
//   node src/qoyod-probe.js
//
// It reads QOYOD_API_KEY from .env via config.js — no secrets on the command line.

import { config } from './config.js';

const BASE = 'https://www.qoyod.com/2.0';

async function get(endpoint) {
  const res = await fetch(`${BASE}${endpoint}`, { headers: { 'API-KEY': config.qoyodApiKey } });
  let json = null; try { json = await res.json(); } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, json };
}
function firstArray(obj) { for (const v of Object.values(obj || {})) if (Array.isArray(v)) return v; return []; }

if (!config.qoyodApiKey) {
  console.error('✗ QOYOD_API_KEY is not set in .env — nothing to probe.');
  process.exit(1);
}

console.log(`Qoyod probe → ${BASE}  (dry-run: ${config.qoyodDryRun !== false}, VAT: ${config.vatPercent}%)\n`);

const auth = await get('/customers');
if (!auth.ok) {
  console.error(`✗ Auth/connectivity failed (HTTP ${auth.status}). Check the key.`, auth.json || '');
  process.exit(1);
}
console.log('✓ Authenticated.\n');

const inv = firstArray((await get('/inventories')).json);
const cat = firstArray((await get('/categories')).json);
const unit = firstArray((await get('/product_unit_types')).json);
const accts = firstArray((await get('/accounts')).json);
const revenue = accts.filter((a) => /revenue|income/i.test(String(a.type) + a.parent_type + a.group_type) || /sales|مبيعات|إيراد/i.test(String(a.name_en) + a.name_ar));
const expense = accts.filter((a) => /expense|مصروف/i.test(String(a.type) + a.parent_type + a.group_type));

const line = (label, arr, fmt) => {
  console.log(`${label} (${arr.length}):`);
  arr.slice(0, 6).forEach((x) => console.log('   ' + fmt(x)));
  console.log('');
};
line('Inventories', inv, (x) => `id=${x.id}  ${x.name || x.ar_name}`);
line('Categories', cat, (x) => `id=${x.id}  ${x.name_en || x.name_ar || x.name}`);
line('Unit types', unit, (x) => `id=${x.id}  ${x.name_en || x.name_ar || x.name}`);
line('Revenue accounts (sales)', revenue, (x) => `id=${x.id}  ${x.code}  ${x.name_en || x.name_ar}`);
line('Expense accounts (for expense form)', expense, (x) => `id=${x.id}  ${x.code}  ${x.name_en || x.name_ar}`);

console.log('Suggested .env overrides (optional — the module auto-discovers these):');
console.log(`  QOYOD_INVENTORY_ID=${inv[0]?.id ?? ''}`);
console.log(`  QOYOD_CATEGORY_ID=${cat[0]?.id ?? ''}`);
console.log(`  QOYOD_UNIT_TYPE_ID=${unit[0]?.id ?? ''}`);
console.log(`  QOYOD_SALES_ACCOUNT_ID=${(revenue[0] || accts[0])?.id ?? ''}`);
console.log('  QOYOD_TAX_ID=1   # verify: the 15% VAT tax record in your tenant');
