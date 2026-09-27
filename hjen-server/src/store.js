// JSON-file store — zero deps. invitees.json holds the gate state; events.jsonl
// is the append-only usage log (the remote measurement the desktop app lacks).
// All read-modify-write on invitees.json is serialized through one promise chain
// so the make counter is race-free under concurrent requests.

import fs from 'node:fs';
import path from 'node:path';
import { config, paths, genId } from './config.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Governance tiers — the "category" every account belongs to. Each plan sets a
// default quota + validity; the owner can still fine-tune any single account.
// This is the lever HJEN governs users by (individuals + teams).
export const PLANS = {
  trial:      { label: 'Trial',      genLimit: 40,   durationDays: 15 },
  pro:        { label: 'Pro',        genLimit: 200,  durationDays: 30 },
  team:       { label: 'Team',       genLimit: 500,  durationDays: 30 },
  enterprise: { label: 'Enterprise', genLimit: 2000, durationDays: 90 },
};

function ensureDataDir() {
  for (const dir of [config.dataDir, paths.refs(), paths.outputs(), paths.skills()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readInvitees() {
  ensureDataDir();
  const f = paths.invitees();
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return []; }
}

function writeInviteesAtomic(list) {
  ensureDataDir();
  const f = paths.invitees();
  const tmp = `${f}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
    fs.renameSync(tmp, f);
  } catch (err) {
    // A failed write (classically ENOSPC — disk full) must not leave a turd
    // behind: those `.<pid>.tmp` files pile up on every retry and make a full
    // disk worse (this is exactly the file the ENOSPC banner names). Clean it
    // up and surface a clear, actionable error instead of a bare syscall line.
    try { fs.unlinkSync(tmp); } catch { /* tmp may never have been created */ }
    if (err && err.code === 'ENOSPC') {
      const e = new Error('Server storage is full — metering state could not be saved. Free disk on the host (recover cache / old blobs) or grow the data volume.');
      e.code = 'ENOSPC';
      throw e;
    }
    throw err;
  }
}

// Owner-toggled settings (governance switches). Small JSON alongside invitees.
function settingsFile() { return path.join(config.dataDir, 'settings.json'); }
function readSettings() {
  ensureDataDir();
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf-8')); } catch { return {}; }
}
function writeSettings(obj) {
  ensureDataDir();
  fs.writeFileSync(settingsFile(), JSON.stringify(obj, null, 2));
}

let chain = Promise.resolve();
function withLock(fn) {
  const run = chain.then(() => fn());
  chain = run.catch(() => undefined);
  return run;
}

export const store = {
  list() { return readInvitees(); },
  getByToken(token) { return token ? (readInvitees().find((i) => i.magicToken === token) ?? null) : null; },
  getById(id) { return readInvitees().find((i) => i.id === id) ?? null; },

  // Governance switches. clerkSignupApproval=true → new Clerk sign-ups start
  // pending (owner must approve + assign a plan) instead of auto-funded.
  getSettings() { return { clerkSignupApproval: false, ...readSettings() }; },
  setSetting(key, value) { const s = readSettings(); s[key] = value; writeSettings(s); return { clerkSignupApproval: false, ...s }; },

  create(input) {
    return withLock(() => {
      const list = readInvitees();
      const now = Date.now();
      const durationDays = input.durationDays ?? 15;
      const invitee = {
        id: genId(8),
        email: input.email.trim().toLowerCase(),
        name: (input.name || input.email.split('@')[0]).trim(),
        magicToken: genId(32),
        genLimit: input.genLimit,
        genUsed: 0,
        durationDays,
        grantedAt: now,
        expiresAt: now + durationDays * DAY_MS,
        active: input.active !== false, // wave 2+ can be created closed (staggered)
        pending: input.pending === true,  // self-signups await owner approval
        rejected: false,
        note: input.note || '',
        requestedAt: input.pending === true ? now : null,
        wave: input.wave ?? 1,
        createdAt: now,
        lastActiveAt: null,
        firstMakeAt: null,
      };
      list.push(invitee);
      writeInviteesAtomic(list);
      return invitee;
    });
  },

  // Public self-signup for Early Access. Deduped by email (returns the existing
  // record if already requested). Created pending + inactive; the owner approves
  // in /admin. genLimit 0 until approval so a pending user can never make.
  requestAccess(input) {
    return withLock(() => {
      const list = readInvitees();
      const email = (input.email || '').trim().toLowerCase();
      const existing = list.find((i) => i.email === email);
      if (existing) return { invitee: existing, deduped: true };
      const now = Date.now();
      const invitee = {
        id: genId(8),
        email,
        name: (input.name || email.split('@')[0]).trim(),
        country: (input.country || '').slice(0, 60),
        magicToken: genId(32),
        genLimit: 0,
        genUsed: 0,
        durationDays: 15,
        grantedAt: now,
        expiresAt: now + 15 * DAY_MS,
        active: false,
        pending: true,
        rejected: false,
        note: (input.note || '').slice(0, 400),
        plan: 'trial',
        requestedAt: now,
        wave: 0,
        createdAt: now,
        lastActiveAt: null,
        firstMakeAt: null,
      };
      list.push(invitee);
      writeInviteesAtomic(list);
      return { invitee, deduped: false };
    });
  },

  // Owner approves a pending request: clears pending, opens access, grants quota.
  approve(id, opts = {}) {
    return withLock(() => {
      const list = readInvitees();
      const inv = list.find((i) => i.id === id);
      if (!inv) return null;
      const now = Date.now();
      inv.pending = false;
      inv.rejected = false;
      inv.active = true;
      inv.genLimit = opts.genLimit ?? 40;
      inv.durationDays = opts.durationDays ?? 15;
      inv.grantedAt = now;
      inv.expiresAt = now + inv.durationDays * DAY_MS;
      writeInviteesAtomic(list);
      return inv;
    });
  },

  // Owner rejects a pending request: leaves the queue, no access.
  reject(id) {
    return withLock(() => {
      const list = readInvitees();
      const inv = list.find((i) => i.id === id);
      if (!inv) return null;
      inv.pending = false;
      inv.rejected = true;
      inv.active = false;
      writeInviteesAtomic(list);
      return inv;
    });
  },

  // 1-based position of a pending invitee in the waitlist (by request time).
  queuePosition(id) {
    const list = readInvitees().filter((i) => i.pending).sort((a, b) => (a.requestedAt || 0) - (b.requestedAt || 0));
    const idx = list.findIndex((i) => i.id === id);
    return idx < 0 ? null : idx + 1;
  },

  // Find or create the HJEN account bound to a Clerk user. First sign-in creates
  // a funded, active account (we fund the beta) linked by clerkUserId. Coexists
  // with the magic-link invitees — same account shape, same quota metering.
  getOrCreateByClerkUser(clerkUserId, info = {}) {
    return withLock(() => {
      const list = readInvitees();
      let inv = list.find((i) => i.clerkUserId === clerkUserId);
      if (inv) {
        // Backfill email/name if Clerk resolved them after the account was made.
        if (info.email && (!inv.email || inv.email.endsWith('@clerk.local'))) inv.email = info.email.trim().toLowerCase();
        if (info.name && (!inv.name || inv.name === inv.email?.split('@')[0])) inv.name = info.name.trim();
        writeInviteesAtomic(list);
        return inv;
      }
      const now = Date.now();
      const email = (info.email || `${clerkUserId}@clerk.local`).trim().toLowerCase();
      // Governance gate: when approval is required, new sign-ups start pending
      // (no quota, inactive) until the owner approves — so we never auto-fund.
      const approval = readSettings().clerkSignupApproval === true;
      inv = {
        id: genId(8),
        clerkUserId,
        email,
        name: (info.name || email.split('@')[0]).trim(),
        country: info.country || '',
        magicToken: genId(32),
        genLimit: approval ? 0 : 40,
        genUsed: 0,
        durationDays: 15,
        grantedAt: now,
        expiresAt: now + 15 * DAY_MS,
        active: !approval,
        pending: approval,
        rejected: false,
        note: approval ? 'Clerk sign-up — pending approval' : 'Clerk account',
        requestedAt: approval ? now : null,
        plan: 'trial',
        wave: 0,
        createdAt: now,
        lastActiveAt: null,
        firstMakeAt: null,
      };
      list.push(inv);
      writeInviteesAtomic(list);
      return inv;
    });
  },

  // Bulk-create N invitees for one wave in a single locked write. Emails are
  // auto-labeled (identifier only — links are distributed directly, not emailed).
  createMany(input) {
    return withLock(() => {
      const list = readInvitees();
      const now = Date.now();
      const durationDays = input.durationDays ?? 15;
      const count = Math.max(1, Math.min(500, input.count | 0));
      const wave = input.wave ?? 1;
      const base = list.filter((i) => i.wave === wave).length;
      const made = [];
      for (let k = 0; k < count; k++) {
        const seq = String(base + k + 1).padStart(2, '0');
        const invitee = {
          id: genId(8),
          email: `w${wave}-${seq}@beta.hjen.ai`,
          name: `Tester W${wave}-${seq}`,
          magicToken: genId(32),
          genLimit: input.genLimit ?? 40,
          genUsed: 0,
          durationDays,
          grantedAt: now,
          expiresAt: now + durationDays * DAY_MS,
          active: input.active !== false,
          wave,
          createdAt: now,
          lastActiveAt: null,
          firstMakeAt: null,
        };
        list.push(invitee);
        made.push(invitee);
      }
      writeInviteesAtomic(list);
      return made;
    });
  },

  // Find or create the SHARED team account bound to a Clerk organization. When a
  // user acts inside an org, the session JWT carries org_id → all members draw
  // from ONE funded team pool. The basis for enterprise seats.
  getOrCreateByClerkOrg(clerkOrgId, info = {}) {
    return withLock(() => {
      const list = readInvitees();
      let inv = list.find((i) => i.clerkOrgId === clerkOrgId);
      if (inv) {
        if (info.name && (!inv.name || inv.name === 'Team')) inv.name = info.name.trim();
        writeInviteesAtomic(list);
        return inv;
      }
      const now = Date.now();
      inv = {
        id: genId(8),
        clerkOrgId,
        email: `${clerkOrgId}@org.clerk.local`,
        name: (info.name || 'Team').trim(),
        country: '',
        isOrg: true,
        magicToken: genId(32),
        genLimit: 100, // shared team pool (owner adjusts in /admin)
        genUsed: 0,
        durationDays: 15,
        grantedAt: now,
        expiresAt: now + 15 * DAY_MS,
        active: true,
        pending: false,
        rejected: false,
        note: 'Clerk organization',
        plan: 'team',
        wave: 0,
        createdAt: now,
        lastActiveAt: null,
        firstMakeAt: null,
      };
      list.push(inv);
      writeInviteesAtomic(list);
      return inv;
    });
  },

  // Assign an account's plan (category) and apply the plan's default quota +
  // validity. Keeps genUsed; extends validity from now. The governance lever.
  setPlan(id, plan) {
    return withLock(() => {
      const p = PLANS[plan];
      if (!p) return null;
      const list = readInvitees();
      const inv = list.find((i) => i.id === id);
      if (!inv) return null;
      const now = Date.now();
      inv.plan = plan;
      inv.genLimit = p.genLimit;
      inv.durationDays = p.durationDays;
      inv.expiresAt = now + p.durationDays * DAY_MS;
      inv.active = true;
      inv.pending = false;
      inv.rejected = false;
      writeInviteesAtomic(list);
      return inv;
    });
  },

  // Apply a Paddle subscription to an account. Unlike setPlan (the manual
  // /admin lever), validity follows the PAID billing period — an annual
  // subscriber must not expire on the plan's 30-day default — and a renewal
  // resets the usage counter for the new period. planSource marks who owns the
  // plan so /admin shows manual grants and paid plans apart.
  applyPaddleSubscription(id, plan, opts = {}) {
    return withLock(() => {
      const p = PLANS[plan];
      if (!p) return null;
      const list = readInvitees();
      const inv = list.find((i) => i.id === id);
      if (!inv) return null;
      const now = Date.now();
      inv.plan = plan;
      inv.genLimit = p.genLimit * Math.max(1, opts.quantity ?? 1);
      if (opts.resetUsed) inv.genUsed = 0;
      // Paid-through date from Paddle (+3 days grace for retried payments),
      // falling back to the plan default.
      inv.expiresAt = opts.paidUntil
        ? opts.paidUntil + 3 * DAY_MS
        : now + p.durationDays * DAY_MS;
      inv.active = true;
      inv.pending = false;
      inv.rejected = false;
      inv.planSource = 'paddle';
      if (opts.customerId) inv.paddleCustomerId = opts.customerId;
      if (opts.subscriptionId) inv.paddleSubscriptionId = opts.subscriptionId;
      writeInviteesAtomic(list);
      return inv;
    });
  },

  // Apply a one-off Moyasar purchase (the Saudi rail). Moyasar has no native
  // subscriptions, so a purchase grants ONE paid period: the plan quota + a fresh
  // usage counter, valid for the plan's durationDays (30 for Pro/Team). No
  // provider-side renewal — the account falls back to trial when it expires unless
  // the user buys again. planSource marks it as a Moyasar purchase in /admin.
  applyMoyasarPurchase(id, plan, opts = {}) {
    return withLock(() => {
      const p = PLANS[plan];
      if (!p) return null;
      const list = readInvitees();
      const inv = list.find((i) => i.id === id);
      if (!inv) return null;
      const now = Date.now();
      inv.plan = plan;
      inv.genLimit = p.genLimit;
      inv.genUsed = 0; // one-off purchase = a fresh period
      inv.expiresAt = now + p.durationDays * DAY_MS;
      inv.active = true;
      inv.pending = false;
      inv.rejected = false;
      inv.planSource = 'moyasar';
      if (opts.paymentId) inv.moyasarPaymentId = opts.paymentId;
      if (opts.invoiceId) inv.moyasarInvoiceId = opts.invoiceId;
      inv.lastPurchaseAt = now;
      writeInviteesAtomic(list);
      return inv;
    });
  },

  // A canceled/expired Paddle subscription falls back to the trial tier without
  // touching the account itself (projects, profile, history all stay).
  endPaddleSubscription(id) {
    return withLock(() => {
      const list = readInvitees();
      const inv = list.find((i) => i.id === id);
      if (!inv) return null;
      const p = PLANS.trial;
      inv.plan = 'trial';
      inv.genLimit = Math.min(inv.genLimit, p.genLimit);
      inv.expiresAt = Date.now() + p.durationDays * DAY_MS;
      inv.planSource = 'paddle-ended';
      inv.paddleSubscriptionId = null;
      writeInviteesAtomic(list);
      return inv;
    });
  },

  // Open or close an entire wave at once (enforced staggering of the launch).
  setWaveActive(wave, active) {
    return withLock(() => {
      const list = readInvitees();
      let changed = 0;
      for (const inv of list) if (inv.wave === wave) { inv.active = !!active; changed++; }
      writeInviteesAtomic(list);
      return changed;
    });
  },

  // Reserve one make atomically (active + not expired + remaining). Reserved
  // up-front to prevent over-charge under concurrency; the route refunds on
  // provider failure so failed makes never burn quota. The route logs 'make'.
  consumeMake(token) {
    return withLock(() => {
      const list = readInvitees();
      const idx = list.findIndex((i) => i.magicToken === token);
      if (idx < 0) return { ok: false, reason: 'not_found' };
      const inv = list[idx];
      if (!inv.active) return { ok: false, reason: 'inactive' };
      if (Date.now() >= inv.expiresAt) return { ok: false, reason: 'expired' };
      if (inv.genUsed >= inv.genLimit) return { ok: false, reason: 'exhausted' };
      const now = Date.now();
      inv.genUsed += 1;
      inv.lastActiveAt = now;
      if (!inv.firstMakeAt) inv.firstMakeAt = now;
      list[idx] = inv;
      writeInviteesAtomic(list);
      return { ok: true, invitee: inv };
    });
  },

  refund(token) {
    return withLock(() => {
      const list = readInvitees();
      const inv = list.find((i) => i.magicToken === token);
      if (inv && inv.genUsed > 0) { inv.genUsed -= 1; writeInviteesAtomic(list); }
    });
  },

  // Idempotent refund keyed by an async job's taskId. Video is charged on submit
  // but the render can still FAIL later (surfaced on poll); this refunds that make
  // exactly once, no matter how many times the client polls the failed task.
  refundForTask(token, taskId) {
    return withLock(() => {
      if (!taskId) return { ok: false };
      const list = readInvitees();
      const inv = list.find((i) => i.magicToken === token);
      if (!inv) return { ok: false };
      inv.refundedTasks = inv.refundedTasks || [];
      if (inv.refundedTasks.includes(taskId)) return { ok: false, already: true };
      inv.refundedTasks.push(taskId);
      if (inv.refundedTasks.length > 500) inv.refundedTasks = inv.refundedTasks.slice(-500);
      if (inv.genUsed > 0) inv.genUsed -= 1;
      writeInviteesAtomic(list);
      return { ok: true };
    });
  },

  touch(token) {
    return withLock(() => {
      const list = readInvitees();
      const inv = list.find((i) => i.magicToken === token);
      if (inv) { inv.lastActiveAt = Date.now(); writeInviteesAtomic(list); }
    });
  },

  extend(id, addDays) {
    return withLock(() => {
      const list = readInvitees();
      const inv = list.find((i) => i.id === id);
      if (!inv) return null;
      const base = Math.max(Date.now(), inv.expiresAt);
      inv.expiresAt = base + addDays * DAY_MS;
      inv.durationDays += addDays;
      inv.active = true;
      writeInviteesAtomic(list);
      return inv;
    });
  },

  setActive(id, active) {
    return withLock(() => {
      const list = readInvitees();
      const inv = list.find((i) => i.id === id);
      if (!inv) return null;
      inv.active = active;
      writeInviteesAtomic(list);
      return inv;
    });
  },

  bumpLimit(id, addMakes) {
    return withLock(() => {
      const list = readInvitees();
      const inv = list.find((i) => i.id === id);
      if (!inv) return null;
      inv.genLimit += addMakes;
      writeInviteesAtomic(list);
      return inv;
    });
  },
};

export function appendEvent(ev) {
  ensureDataDir();
  fs.appendFileSync(paths.events(), JSON.stringify(ev) + '\n');
}

export function readEvents() {
  const f = paths.events();
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e !== null);
}

export function gateStatus(inv) {
  const remaining = Math.max(0, inv.genLimit - inv.genUsed);
  const daysLeft = Math.max(0, Math.ceil((inv.expiresAt - Date.now()) / DAY_MS));
  if (inv.pending) return { ok: false, reason: 'pending', remaining, daysLeft };
  if (inv.rejected) return { ok: false, reason: 'rejected', remaining, daysLeft };
  if (!inv.active) return { ok: false, reason: 'inactive', remaining, daysLeft };
  if (Date.now() >= inv.expiresAt) return { ok: false, reason: 'expired', remaining, daysLeft };
  if (inv.genUsed >= inv.genLimit) return { ok: false, reason: 'exhausted', remaining, daysLeft };
  return { ok: true, remaining, daysLeft };
}
