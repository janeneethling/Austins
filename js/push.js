// Web Push (iPhone: only works when opened from the Home Screen, iOS 16.4+)
import { CONFIG } from './config.js';
import { api, DEMO } from './api.js';

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export function pushStatus() {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  if (isIOS() && !isStandalone()) return 'install';
  if (!('PushManager' in window) || !('Notification' in window)) return isIOS() ? 'install' : 'unsupported';
  if (!CONFIG.VAPID_PUBLIC_KEY && !DEMO) return 'not-configured';
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}
const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); return Uint8Array.from(atob((s + p).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)); };
export async function currentSub() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager ? reg.pushManager.getSubscription() : null;
}
export const getPrefs = () => { try { return { events: true, digest: true, budget: true, ...JSON.parse(localStorage.getItem('onstwee-push-prefs') || '{}') }; } catch { return { events: true, digest: true, budget: true }; } };
export async function savePrefs(prefs) {
  localStorage.setItem('onstwee-push-prefs', JSON.stringify(prefs));
  const sub = await currentSub();
  if (sub && !DEMO) await api.save('push_subscriptions', { endpoint: sub.endpoint, subscription: sub.toJSON(), prefs });
}
export async function enablePush(userId) {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('denied');
  const reg = await navigator.serviceWorker.ready;
  if (DEMO) return;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(CONFIG.VAPID_PUBLIC_KEY) });
  await api.save('push_subscriptions', { endpoint: sub.endpoint, user_id: userId, subscription: sub.toJSON(), prefs: getPrefs() });
}
export async function disablePush() {
  const sub = await currentSub();
  if (sub) { if (!DEMO) await api.removeWhere('push_subscriptions', 'endpoint', sub.endpoint).catch(() => {}); await sub.unsubscribe(); }
}
export async function testNotification() {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('🛒 It works!', { body: 'Notifications are on for this phone 💕', icon: 'icons/icon-192.png', tag: 'test' });
}
