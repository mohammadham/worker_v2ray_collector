import { kvGet } from '../utils/kv.js';
import { detectType, extractServer, getFlag } from '../utils/vpn.js';
import { DEFAULT_TEMPLATES, DEFAULT_SETTINGS } from '../constants.js';

export async function configKeyboard(env, config, hash, channelInfo = null) {
  const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
  let shareUrl = `https://t.me/share/url?url=${encodeURIComponent(config)}`;

  if (channelInfo) {
    if (String(channelInfo).startsWith('@')) {
      shareUrl = `https://t.me/${channelInfo.substring(1)}`;
    }
  }

  const rows = [];

  // Conditionally add Report button
  if (settings.enableReportButton !== false) {
    rows.push([{ text: "👎 Report", callback_data: `dislike_${hash}` }]);
  }

  const secondRow = [{ text: "📤 Share", url: shareUrl }];

  // Toggle between Open and QR Code
  if (settings.enableQRButton) {
    const qrUrl = `https://kissapi-qrcode.vercel.app/api/qrcode?cht=qr&chs=200x200&chl=${encodeURIComponent(config)}`;
    secondRow.push({ text: "🖼️ QR Code", url: qrUrl });
  } else {
    secondRow.push({ text: "📱 Open", url: `https://t.me/share/url?url=${encodeURIComponent(config)}` });
  }

  rows.push(secondRow);

  return { inline_keyboard: rows };
}

export async function formatMessage(env, config, testResult, votes = null, channelInfo = null, bundleConfigs = null, userAttr = null) {
  const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
  const templates = await kvGet(env, "message_templates", DEFAULT_TEMPLATES);

  let channel = "VPN Config Bot";

  if (config && config.provider) {
    channel = config.provider;
  } else if (channelInfo) {
    channel = String(channelInfo);
    // If numeric channel ID matches env.CHANNEL_ID, use channelUsername
    if (channel === env.CHANNEL_ID && settings.channelUsername) {
      channel = settings.channelUsername;
    }
  }

  if (channel.startsWith("@")) channel = channel.substring(1);
  if (!channel.startsWith("https://t.me/") && !/^[\d-]+$/.test(channel)) {
    channel = "@" + channel;
  }

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
