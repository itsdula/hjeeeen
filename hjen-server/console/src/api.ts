// Talks to the existing HJEN server admin API (/api/admin/*) with the ADMIN_TOKEN.
// The console is a separate surface; the beta's /admin keeps running untouched.

const TOKEN_KEY = 'hjen_admin_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function req(path: string, opts: RequestInit = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { Authorization: `Bearer ${getToken()}`, ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({ ok: false }));
  return { status: res.status, data };
}

export interface Invitee {
  id: string;
  name: string;
  email: string;
  plan?: string;
  genUsed: number;
  genLimit: number;
  daysLeft: number;
  spentUsd: number;
  gateOpen: boolean;
  active: boolean;
  pending: boolean;
  rejected: boolean;
  isOrg?: boolean;
  clerkUserId?: string;
  clerkOrgId?: string;
  country?: string;
  note?: string;
  magicLink?: string;
  wave?: number;
  activated?: boolean;
}

export const api = {
  async verify(token: string) {
    setToken(token);
    const { status } = await req('/api/admin/invitees');
    return status === 200;
  },
  async invitees(): Promise<{ invitees: Invitee[]; totals: any }> {
    const { data } = await req('/api/admin/invitees');
    return { invitees: data.invitees || [], totals: data.totals || {} };
  },
  async activity() {
    const { data } = await req('/api/admin/activity');
    return data;
  },
  async settings() {
    const { data } = await req('/api/admin/settings');
    return data.settings || {};
  },
  async setSetting(clerkSignupApproval: boolean) {
    await req('/api/admin/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clerkSignupApproval }) });
  },
  async setPlan(id: string, plan: string) {
    await req('/api/admin/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, plan }) });
  },
  async orgMembers(orgId: string) {
    const { data } = await req('/api/admin/org?orgId=' + encodeURIComponent(orgId));
    return data.members || [];
  },
  async action(act: 'extend' | 'bump' | 'stop' | 'activate' | 'approve' | 'reject', body: any) {
    await req('/api/admin/' + act, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  },
  async impersonate(id: string): Promise<string | null> {
    const { data } = await req('/api/admin/impersonate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    return data.ok ? data.link : null;
  },
  async audit() {
    const { data } = await req('/api/admin/audit');
    return data.events || [];
  },
  async qoyodStatus() {
    const { data } = await req('/api/admin/qoyod/status');
    return data.qoyod || {};
  },
  async qoyodExpenseCategories(): Promise<{ id: number; name: string; code?: string }[]> {
    const { data } = await req('/api/admin/qoyod/expense-categories');
    return data.categories || [];
  },
  async qoyodExpense(body: any) {
    const { data } = await req('/api/admin/qoyod/expense', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return data;
  },
};
