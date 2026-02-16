// ======== KV Helpers with Local Caching ========
export const KV_CACHE = new Map();
export const CACHE_TTL = 5000;

export async function kvGet(env, key, defaultVal = null) {
  const cached = KV_CACHE.get(key);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.value;
  }

  try {
    const val = await env.VPN_CACHE.get(key, "json");
    const result = (val !== null && val !== undefined) ? val : defaultVal;
    KV_CACHE.set(key, { value: result, time: Date.now() });
    return result;
  } catch (e) {
    return defaultVal;
  }
}

export async function kvSet(env, key, value) {
  await env.VPN_CACHE.put(key, JSON.stringify(value));
  KV_CACHE.set(key, { value, time: Date.now() });
}

export async function kvDelete(env, key) {
  await env.VPN_CACHE.delete(key);
  KV_CACHE.delete(key);
}

export async function trackUser(env, chatId) {
  if (!chatId) return;
  const sChatId = String(chatId);
  const users = await kvGet(env, "bot_users", []);
  if (!users.includes(sChatId)) {
    users.push(sChatId);
    await kvSet(env, "bot_users", users);
  }
}
