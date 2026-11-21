import { Capacitor, CapacitorHttp } from '@capacitor/core';
export const native = Capacitor.isNativePlatform();
const BASE = __PLU_API_BASE__;
let appToken = null;
let csrf = null;
export const MOBILE = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Windows Phone|Opera Mini|webOS|Silk|Kindle/i;
export const mobileBrowser = !native && MOBILE.test(navigator.userAgent);
export const adminPath = native ? '/api/app/items' : '/api/items';
export const auditPath = native ? '/api/app/audit' : '/api/audit';
export async function request(path, { method = 'GET', data } = {}) {
  const headers = { Accept: 'application/json' };
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  if (native && appToken) headers.Authorization = `Bearer ${appToken}`;
  if (!native && csrf) headers['X-CSRF-Token'] = csrf;
  let status, body;
  if (native) {
    const r = await CapacitorHttp.request({ url: BASE + path, method, headers, data, connectTimeout: 10000, readTimeout: 15000 });
    status = r.status;
    try { body = typeof r.data === 'string' ? JSON.parse(r.data) : r.data; } catch { body = {}; }
  } else {
    const r = await fetch(path, { method, headers, credentials: 'same-origin', body: data === undefined ? undefined : JSON.stringify(data), cache: 'no-store' });
    status = r.status; body = await r.json().catch(() => ({}));
  }
  if (status < 200 || status >= 300) {
    const e = new Error(body.error || `Request failed (${status})`); e.status = status; throw e;
  }
  return body;
}
export async function me() {
  if (native && !appToken) return { authenticated: false };
  const data = await request(native ? '/api/app/me' : '/api/me');
  if (data.csrf) csrf = data.csrf;
  return data;
}
export async function login(username, password) {
  const data = await request(native ? '/api/app/login' : '/api/login', { method: 'POST', data: { username, password } });
  if (native) appToken = data.token; else csrf = data.csrf;
  return data;
}
export async function logout() {
  try { await request(native ? '/api/app/logout' : '/api/logout', { method: 'POST' }); }
  finally { appToken = null; csrf = null; }
}
// Only public catalog/favorites are persisted. Passwords and admin bearer tokens are never stored in localStorage/APK.
