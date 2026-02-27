import { kvGet } from '../utils/kv.js';
import { sendTelegram } from '../utils/telegram.js';

export async function startBroadcast(env, message) {
  const users = await kvGet(env, "bot_users", []);
  if (!users.length) return { total: 0, sent: 0, failed: 0 };

  const stats = { total: users.length, sent: 0, failed: 0 };

  // We process them sequentially through the rate limiter
  for (const chatId of users) {
    try {
      const result = await sendTelegram(env, chatId, message);
      if (result) stats.sent++;
      else stats.failed++;
    } catch (e) {
      console.error(`Broadcast failed for ${chatId}:`, e);
      stats.failed++;
    }
  }

  // Log completion to admin
  await sendTelegram(env, env.ADMIN_CHAT_ID, `📢 Broadcast Completed!\n✅ Sent: ${stats.sent}\n❌ Failed: ${stats.failed}\n👥 Total Users: ${stats.total}`);

  return stats;
}
