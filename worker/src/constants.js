export const CONFIG_PATTERNS = [
  /vless:\/\/[^\s<>"]+/g,
  /vmess:\/\/[^\s<>"]+/g,
  /trojan:\/\/[^\s<>"]+/g,
  /ss:\/\/[^\s<>"]+/g,
];

export const DEFAULT_TEMPLATES = {
  vless: "🟢 *VLESS Config*\n🌍 Server: {server}\n📍 Location: {location}\n📊 Status: {status}\n⭐ Rating: {rating}\n📢 {channel}",
  vmess: "🔵 *VMess Config*\n🌍 Server: {server}\n📍 Location: {location}\n📊 Status: {status}\n⭐ Rating: {rating}\n📢 {channel}",
  trojan: "🔴 *Trojan Config*\n🌍 Server: {server}\n📍 Location: {location}\n📊 Status: {status}\n⭐ Rating: {rating}\n📢 {channel}",
  ss: "🟡 *Shadowsocks Config*\n🌍 Server: {server}\n📍 Location: {location}\n📊 Status: {status}\n⭐ Rating: {rating}\n📢 {channel}",
  default: "⚪ *VPN Config*\n🌍 Server: {server}\n📍 Location: {location}\n📊 Status: {status}\n⭐ Rating: {rating}\n📢 {channel}",
  user_bundle: "🎁 *User Contribution*\n👤 Contributor: {user}\n📦 Total: {count} configs\n\n{configs}\n\n📢 {channel}"
};

export const DEFAULT_SETTINGS = {
  maxFailedTests: 1000,
  autoDeleteDays: 3,
  staleDeleteDays: 5,
  pendingDeleteHours: 48,
  enableRedirect: false,
  redirectUrl: "",
  activeTemplate: "default",
  rateLimitPerSecond: 30,
  minLikesToKeep: 1,
  enableQueue: false,
  queueIntervalMin: 15,
  queueBatchSize: 1
};
