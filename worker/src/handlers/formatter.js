import { kvGet } from '../utils/kv.js';
import { detectType, extractServer, getFlag } from '../utils/vpn.js';
import { DEFAULT_TEMPLATES, DEFAULT_SETTINGS } from '../constants.js';

export function configKeyboard(config, hash, channelInfo = null) {
  let shareUrl = `https://t.me/share/url?url=${encodeURIComponent(config)}`;

  if (channelInfo) {
    if (String(channelInfo).startsWith('@')) {
      shareUrl = `https://t.me/${channelInfo.substring(1)}`;
    }
  }

  return { inline_keyboard: [
    [{ text: "👎 Report", callback_data: `dislike_${hash}` }],
    [{ text: "📤 Share", url: shareUrl }, { text: "📱 Open", url: `https://t.me/share/url?url=${encodeURIComponent(config)}` }]
  ]};
}

export async function formatMessage(env, config, testResult, votes = null, channelInfo = null, bundleConfigs = null, userAttr = null) {
  const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
  const templates = await kvGet(env, "message_templates", DEFAULT_TEMPLATES);

  const channel = channelInfo || "VPN Config Bot";

  // Handle bundle case
  if (bundleConfigs && Array.isArray(bundleConfigs)) {
    const template = templates.user_bundle || DEFAULT_TEMPLATES.user_bundle;
    const configsText = bundleConfigs.map(c => `\`${c}\``).join("\n\n");
    return template
      .replace(/{configs}/g, configsText)
      .replace(/{user}/g, userAttr || "Anonymous")
      .replace(/{count}/g, bundleConfigs.length)
      .replace(/{channel}/g, channel);
  }

  let templateKey = settings.activeTemplate;
  if (templateKey === 'default' || !templates[templateKey]) {
    templateKey = detectType(config);
  }

  const template = templates[templateKey] || templates.default || DEFAULT_TEMPLATES.default;
  const { host, port } = extractServer(config);
  const server = host ? `${host}:${port}` : "Unknown";
  const emoji = testResult.status === "active" ? "✅" : testResult.status === "dns_only" ? "⚠️" : "❌";

  const rating = votes ? `👍 ${votes.likes.length} | 👎 ${votes.dislikes.length}` : "N/A";
  const flag = getFlag(testResult.countryCode);
  const location = `${flag} ${testResult.country || "Unknown"}`;

  return template
    .replace(/{type}/g, detectType(config).toUpperCase())
    .replace(/{server}/g, server)
    .replace(/{status}/g, `${emoji} ${testResult.message}`)
    .replace(/{rating}/g, rating)
    .replace(/{latency}/g, testResult.latency > 0 ? `${testResult.latency}ms` : "N/A")
    .replace(/{channel}/g, channel)
    .replace(/{location}/g, location)
    + `\n\n\`${config}\``;
}
