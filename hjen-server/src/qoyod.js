// Qoyod — the Saudi accounting / ZATCA rail. Zero-dependency.
//
// Qoyod is ZATCA Phase-2 certified: creating an invoice through its API auto-
// signs it and submits it to FATOORA, so HJEN never builds e-invoicing itself.
// This module (1) turns every confirmed sale into an "Approved" Qoyod invoice
// (net price + VAT) and (2) records admin-entered expenses as Qoyod bills.
//
// SAFETY — two independent gates before any live invoice is created:
//   1. qoyodConfigured()  → QOYOD_API_KEY must be present (else fully dormant).
//   2. config.qoyodDryRun → default TRUE: we log the exact invoice JSON and
//      create NOTHING until the owner flips QOYOD_DRY_RUN=false. Dry-run never
//      marks a sale as seen, so flipping to live still issues the real invoices.
//
// Keys live in env only (recipe-stays-server-side). Never called from a request
// with client-supplied amounts — the sale amount is the server's own, the
// expense amount is admin-gated. A Qoyod failure NEVER blocks a payment grant:
// recordSale is fire-and-forget and enqueues failures for the retry sweep.
//
// API contract (verified from Qoyod's published Postman collection):
//   Base  https://www.qoyod.com/2.0/   Header  API-KEY: <key>
//   POST /invoices  { invoice:{ contact_id, reference, status:"Approved",
//        inventory_id, line_items:[{ product_id, unit_price, tax_percent }] } }
//   POST /customers { contact:{ name, email, tax_number, status:"Active" } }
//   POST /products  { product:{ sku, name_ar, name_en, category_id,
//        product_unit_type_id, sale_item:"1", selling_price, sales_account_id, tax_id } }
//   POST /simple_bills { simple_bill:{ contact_id, status, issue_date,
//        inventory_id, simple_bill_items_attributes:[{ expense_category_id,
//        description, total_amount, tax_id }] } }

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { vatPercent } from './money.js';

const API_BASE = 'https://www.qoyod.com/2.0';
const TAG = '[qoyod]';

export function qoyodConfigured() {
  return !!config.qoyodApiKey;
}
function dryRun() {
  return config.qoyodDryRun !== false; // default-safe: anything but explicit false is dry
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
async function api(method, endpoint, body) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: {
      'API-KEY': config.qoyodApiKey,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON / empty */ }
  return { ok: res.ok, status: res.status, json };
}

// Qoyod list endpoints wrap the array under a resource key (accounts, customers,
// …); create endpoints echo the object under its singular key. Pull defensively.
function firstArray(obj) {
  if (!obj || typeof obj !== 'object') return [];
  for (const v of Object.values(obj)) if (Array.isArray(v)) return v;
  return [];
}
function idOf(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.id != null) return obj.id;
  for (const v of Object.values(obj)) if (v && typeof v === 'object' && v.id != null) return v.id;
  return null;
}

// ── tiny JSON-file stores (house idiom: sync read/write, fresh-start on error) ─
function jpath(name) { return path.join(config.dataDir, name); }
function jread(name, fallback) {
  try { return JSON.parse(fs.readFileSync(jpath(name), 'utf-8')); } catch { return fallback; }
}
function jwrite(name, value) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(jpath(name), JSON.stringify(value));
}

const SEEN = 'qoyod_seen.json';       // srcRef → invoiceId (sale idempotency)
const RETRY = 'qoyod_retry.json';     // [ recordSale args ] failed-push queue
const CUSTOMERS = 'qoyod_customers.json'; // emailLower → customerId
const VENDORS = 'qoyod_vendors.json'; // vendorNameLower → vendorId
const PRODUCTS = 'qoyod_products.json'; // plan sku → productId
const REFS = 'qoyod_refs.json';       // resolved tenant defaults

// ── reference-id resolution (config overrides → discovered tenant defaults) ────
// tax_id has no list endpoint in the API, so it is config-driven with the KSA
// default (id 1 = the standard 15% VAT record in a fresh Qoyod tenant).
async function resolveRefs() {
  const cached = jread(REFS, null);
  const fromConfig = {
    inventory_id: config.qoyodInventoryId || cached?.inventory_id || null,
    category_id: config.qoyodCategoryId || cached?.category_id || null,
    product_unit_type_id: config.qoyodUnitTypeId || cached?.product_unit_type_id || null,
    sales_account_id: config.qoyodSalesAccountId || cached?.sales_account_id || null,
    tax_id: config.qoyodTaxId || cached?.tax_id || '1',
  };
  // If everything we need is already known, don't hit the API.
  if (fromConfig.inventory_id && fromConfig.category_id && fromConfig.product_unit_type_id && fromConfig.sales_account_id) {
    return fromConfig;
  }
  const refs = { ...fromConfig };
  if (!refs.inventory_id) {
    const r = await api('GET', '/inventories');
    refs.inventory_id = idOf(firstArray(r.json)[0]) ?? refs.inventory_id;
  }
  if (!refs.category_id) {
    const r = await api('GET', '/categories');
    refs.category_id = idOf(firstArray(r.json)[0]) ?? refs.category_id;
  }
  if (!refs.product_unit_type_id) {
    const r = await api('GET', '/product_unit_types');
    refs.product_unit_type_id = idOf(firstArray(r.json)[0]) ?? refs.product_unit_type_id;
  }
  if (!refs.sales_account_id) {
    const r = await api('GET', '/accounts');
    const accts = firstArray(r.json);
    // prefer a revenue/income (sales) account; fall back to the first account.
    const revenue = accts.find((a) =>
      /revenue|income/i.test(String(a.type) + a.parent_type + a.group_type)
      || /sales|مبيعات|إيراد/i.test(String(a.name_en) + a.name_ar));
    refs.sales_account_id = idOf(revenue) ?? idOf(accts[0]) ?? refs.sales_account_id;
  }
  jwrite(REFS, refs);
  return refs;
}

// ── customer find-or-create (by email) ────────────────────────────────────────
async function findOrCreateCustomer({ email, name, country }) {
  const key = String(email || '').trim().toLowerCase();
  const cache = jread(CUSTOMERS, {});
  if (key && cache[key]) return cache[key];

  // Best-effort lookup: scan the customer list for the email (first page). The
  // cache below makes this a one-time cost per buyer; a miss on a paginated
  // tenant only risks a duplicate contact, never a wrong or missing invoice.
  if (key) {
    const r = await api('GET', '/customers');
    const found = firstArray(r.json).find((c) => String(c.email || '').trim().toLowerCase() === key);
    if (found?.id != null) { if (key) { cache[key] = found.id; jwrite(CUSTOMERS, cache); } return found.id; }
  }
  const r = await api('POST', '/customers', {
    contact: {
      name: name || (key ? key.split('@')[0] : 'HJEN customer'),
      email: email || '',
      status: 'Active',
      ...(country ? { billing_address: { billing_country: country } } : {}),
    },
  });
  const id = idOf(r.json);
  if (!r.ok || id == null) throw new Error(`customer create failed (${r.status}): ${JSON.stringify(r.json)}`);
  if (key) { cache[key] = id; jwrite(CUSTOMERS, cache); }
  return id;
}

// ── product find-or-create (one per plan; cycle lives on the invoice line) ─────
function planSku(plan) { return `hjen-${String(plan || 'plan').toLowerCase()}`; }

async function findOrCreateProduct(plan, refs) {
  const sku = planSku(plan);
  const cache = jread(PRODUCTS, {});
  if (cache[sku]) return cache[sku];

  const r = await api('GET', '/products');
  const found = firstArray(r.json).find((p) => String(p.sku || '').toLowerCase() === sku);
  if (found?.id != null) { cache[sku] = found.id; jwrite(PRODUCTS, cache); return found.id; }

  const label = plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Plan';
  const c = await api('POST', '/products/', {
    product: {
      sku,
      name_en: `HJEN Studio — ${label}`,
      name_ar: `هجين ستوديو — ${label}`,
      product_unit_type_id: String(refs.product_unit_type_id),
      category_id: String(refs.category_id),
      sale_item: '1',
      selling_price: '0.0', // invoice sets the real unit_price per sale
      sales_account_id: String(refs.sales_account_id),
      tax_id: String(refs.tax_id),
    },
  });
  const id = idOf(c.json);
  if (!c.ok || id == null) throw new Error(`product create failed (${c.status}): ${JSON.stringify(c.json)}`);
  cache[sku] = id; jwrite(PRODUCTS, cache);
  return id;
}

// ── vendor find-or-create (expenses) ──────────────────────────────────────────
async function findOrCreateVendor({ name, taxNumber }) {
  const key = String(name || '').trim().toLowerCase();
  const cache = jread(VENDORS, {});
  if (key && cache[key]) return cache[key];
  const r = await api('POST', '/vendors', {
    contact: { name: name || 'Vendor', ...(taxNumber ? { tax_number: String(taxNumber) } : {}) },
  });
  const id = idOf(r.json);
  if (!r.ok || id == null) throw new Error(`vendor create failed (${r.status}): ${JSON.stringify(r.json)}`);
  if (key) { cache[key] = id; jwrite(VENDORS, cache); }
  return id;
}

// ── SALES ─────────────────────────────────────────────────────────────────────
// Called fire-and-forget right after a payment grant succeeds. `netSar` is the
// VAT-EXCLUSIVE amount actually collected (charged/1.15 when VAT is on); the
// invoice line adds tax_percent, so declared VAT == collected VAT.
function todayIso() {
  // Date.now-free: derive an ISO date from the process's wall clock via toISOString.
  return new Date(Date.now()).toISOString().slice(0, 10);
}

async function createSaleInvoice({ srcRef, buyer, netSar, plan, cycle, vat }) {
  const refs = await resolveRefs();
  const contact_id = await findOrCreateCustomer(buyer);
  const product_id = await findOrCreateProduct(plan, refs);
  const label = plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Plan';
  const payload = {
    invoice: {
      contact_id,
      reference: srcRef,
      description: `HJEN Studio — ${label} (${cycle || 'monthly'})`,
      issue_date: todayIso(),
      due_date: todayIso(),
      status: 'Approved', // commits + fires the ZATCA e-invoice
      inventory_id: refs.inventory_id,
      line_items: [{
        product_id,
        description: `${label} subscription (${cycle || 'monthly'})`,
        quantity: 1,
        unit_price: Number(Number(netSar).toFixed(2)),
        tax_percent: vat,
      }],
    },
  };
  return payload;
}

/** Record a confirmed sale as a Qoyod invoice. Idempotent by srcRef. Returns
 *  { ok, applied, note, invoiceId? }; never throws (failures enqueue for retry). */
export async function recordSale({ source, srcRef, inv, buyer, netSar, plan, cycle, taxPercentOverride }) {
  if (!qoyodConfigured()) return { ok: true, applied: false, note: 'not_configured' };
  if (!srcRef) return { ok: false, applied: false, note: 'no_ref' };
  const seen = jread(SEEN, {});
  if (seen[srcRef]) return { ok: true, applied: false, note: 'duplicate', invoiceId: seen[srcRef] };

  // Paddle is merchant-of-record — it collects+remits tax itself — so that rail
  // passes taxPercentOverride:0 (record revenue, no Saudi VAT line). Moyasar uses
  // the active VAT rate.
  const vat = (typeof taxPercentOverride === 'number') ? taxPercentOverride : vatPercent();
  const b = buyer || { email: inv?.email, name: inv?.name, country: inv?.country };
  let payload;
  try {
    payload = await createSaleInvoice({ srcRef, buyer: b, netSar, plan: plan || inv?.plan, cycle, vat });
  } catch (e) {
    return failSale({ source, srcRef, buyer: b, netSar, plan: plan || inv?.plan, cycle, taxPercentOverride }, e);
  }

  if (dryRun()) {
    console.log(`${TAG} DRY-RUN sale ${srcRef} → would create invoice:`, JSON.stringify(payload.invoice));
    return { ok: true, applied: false, note: 'dry_run' };
  }
  const r = await api('POST', '/invoices', payload);
  const id = idOf(r.json);
  if (!r.ok || id == null) {
    return failSale({ source, srcRef, buyer: b, netSar, plan: plan || inv?.plan, cycle, taxPercentOverride },
      new Error(`invoice create failed (${r.status}): ${JSON.stringify(r.json)}`));
  }
  seen[srcRef] = id; jwrite(SEEN, seen);
  console.log(`${TAG} sale ${srcRef} → invoice ${id} (${plan || inv?.plan} ${cycle}, net ${netSar} +${vat}% VAT)`);
  return { ok: true, applied: true, note: 'created', invoiceId: id };
}

// Enqueue a failed sale for the retry sweep (deduped by srcRef). Buyer is
// snapshotted to plain fields because the live invitee object won't be around.
function failSale(args, err) {
  console.error(`${TAG} sale ${args.srcRef} failed, queued for retry: ${err?.message || err}`);
  const q = jread(RETRY, []);
  if (!q.find((x) => x.srcRef === args.srcRef)) { q.push({ ...args, attempts: 0 }); jwrite(RETRY, q); }
  return { ok: false, applied: false, note: 'queued', error: String(err?.message || err) };
}

/** Fire-and-forget wrapper for call-sites in the payment path — a Qoyod problem
 *  must never surface to (or block) the buyer, whose money is already captured. */
export function recordSaleSafe(args) {
  recordSale(args).catch((e) => console.error(`${TAG} recordSale threw:`, e?.message || e));
}

// ── retry sweep ───────────────────────────────────────────────────────────────
const MAX_ATTEMPTS = 20;
export async function retryQoyodQueue() {
  if (!qoyodConfigured() || dryRun()) return;
  let q = jread(RETRY, []);
  if (!q.length) return;
  const keep = [];
  for (const item of q) {
    const seen = jread(SEEN, {});
    if (seen[item.srcRef]) continue; // already succeeded via another path
    const r = await recordSale(item).catch((e) => ({ ok: false, note: String(e?.message || e) }));
    if (r?.applied || r?.note === 'duplicate') continue; // done
    const attempts = (item.attempts || 0) + 1;
    if (attempts < MAX_ATTEMPTS) keep.push({ ...item, attempts });
    else console.error(`${TAG} dropping sale ${item.srcRef} after ${attempts} attempts`);
  }
  jwrite(RETRY, keep);
}

let _sweep = null;
export function initQoyodSweep(intervalMs = 5 * 60 * 1000) {
  if (_sweep || !qoyodConfigured()) return;
  _sweep = setInterval(() => { retryQoyodQueue().catch(() => {}); }, intervalMs);
  _sweep.unref?.();
}

// ── EXPENSES (admin-entered) ──────────────────────────────────────────────────
/** Record a business expense as a Qoyod simple bill. Admin-gated at the route.
 *  `amount` is VAT-exclusive; tax_id is attached only when withVat is true. */
export async function recordExpense({ vendorName, vendorTaxNumber, categoryId, description, amount, withVat, issueDate, reference, status }) {
  if (!qoyodConfigured()) return { ok: false, note: 'not_configured' };
  const amt = Number(amount);
  if (!(amt > 0)) return { ok: false, note: 'bad_amount' };
  if (!categoryId) return { ok: false, note: 'no_category' };
  const refs = await resolveRefs();
  const contact_id = await findOrCreateVendor({ name: vendorName, taxNumber: vendorTaxNumber });
  const item = {
    expense_category_id: categoryId,
    description: description || 'Expense',
    total_amount: Number(amt.toFixed(2)),
    ...(withVat ? { tax_id: String(refs.tax_id) } : {}),
  };
  const payload = {
    simple_bill: {
      contact_id,
      status: status || 'Approved',
      issue_date: issueDate || todayIso(),
      inventory_id: refs.inventory_id,
      ...(reference ? { reference } : {}),
      simple_bill_items_attributes: [item],
    },
  };
  if (dryRun()) {
    console.log(`${TAG} DRY-RUN expense → would create simple_bill:`, JSON.stringify(payload.simple_bill));
    return { ok: true, applied: false, note: 'dry_run' };
  }
  const r = await api('POST', '/simple_bills', payload);
  const id = idOf(r.json);
  if (!r.ok || id == null) return { ok: false, note: `create_failed:${r.status}`, detail: r.json };
  return { ok: true, applied: true, note: 'created', billId: id };
}

/** Expense-type accounts, for the admin expense form's category dropdown. */
export async function listExpenseCategories() {
  if (!qoyodConfigured()) return [];
  const r = await api('GET', '/accounts');
  return firstArray(r.json)
    .filter((a) => /expense|مصروف/i.test(String(a.type) + a.parent_type + a.group_type))
    .map((a) => ({ id: a.id, name: a.name_en || a.name_ar, code: a.code }));
}

// ── status (admin/console) ────────────────────────────────────────────────────
export function qoyodStatus() {
  return {
    configured: qoyodConfigured(),
    dryRun: dryRun(),
    vatPercent: vatPercent(),
    paddleEnabled: !!config.qoyodPaddleEnabled,
    queueDepth: jread(RETRY, []).length,
    refs: jread(REFS, null),
    salesRecorded: Object.keys(jread(SEEN, {})).length,
  };
}
