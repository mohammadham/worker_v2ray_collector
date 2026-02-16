import { CONFIG_PATTERNS } from '../constants.js';

// ======== Config Helpers ========
export function extractConfigs(text) {
  const configs = new Set();
  for (const pattern of CONFIG_PATTERNS) {
    const matches = text.match(new RegExp(pattern.source, "g"));
    if (matches) matches.forEach(m => configs.add(m));
  }
  return [...configs];
}

export function detectType(config) {
  if (config.startsWith("vless://")) return "vless";
  if (config.startsWith("vmess://")) return "vmess";
  if (config.startsWith("trojan://")) return "trojan";
  if (config.startsWith("ss://")) return "ss";
  return "unknown";
}

export function getCoreConfig(config) {
  try {
    if (config.startsWith("vmess://")) {
      const b64 = config.replace("vmess://", "").trim();
      const decoded = atob(b64);
      const data = JSON.parse(decoded);
      const coreData = { ...data };
      delete coreData.ps;
      // Sort keys to ensure consistent JSON string regardless of original order
      const sortedData = Object.keys(coreData).sort().reduce((obj, key) => {
        obj[key] = coreData[key];
        return obj;
      }, {});
      return "vmess://" + btoa(JSON.stringify(sortedData));
    }
    // For VLESS, Trojan, SS, the core is everything before the '#'
    return config.split('#')[0];
  } catch (e) {
    return config.split('#')[0] || config;
  }
}

export function hashConfig(config) {
  const core = getCoreConfig(config);
  let hash = 0;
  for (let i = 0; i < core.length; i++) {
    const c = core.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function getFlag(countryCode) {
  if (!countryCode || countryCode === "UN") return "🏳️";
  try {
    return countryCode
      .toUpperCase()
      .replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
  } catch (e) {
    return "🏳️";
  }
}

export function extractServer(config) {
  const type = detectType(config);
  try {
    if (type === "vmess") {
      const b64 = config.replace("vmess://", "").trim();
      try {
        const data = JSON.parse(atob(b64));
        return {
          host: data.add || data.host || "",
          port: parseInt(data.port) || 443,
          remark: data.ps || ""
        };
      } catch (e) {
        // Handle potential base64 padding issues or malformed JSON
        return { host: null, port: null };
      }
    }

    if (type === "vless" || type === "trojan") {
      const url = new URL(config.replace("vless://", "http://").replace("trojan://", "http://"));
      return {
        host: url.hostname.replace(/[\[\]]/g, ""),
        port: parseInt(url.port) || 443,
        remark: decodeURIComponent(url.hash.substring(1))
      };
    }

    if (type === "ss") {
      let part = config.replace("ss://", "");
      let remark = "";
      if (part.includes("#")) {
        const split = part.split("#");
        part = split[0];
        remark = decodeURIComponent(split[1]);
      }

      if (part.includes("@")) {
        const [auth, server] = part.split("@");
        const hp = server.split("?")[0];
        if (hp.includes(":")) {
          const [host, port] = hp.split(":");
          return { host, port: parseInt(port) || 443, remark };
        }
      } else {
        // Legacy SS links are often full base64
        try {
          const decoded = atob(part);
          if (decoded.includes("@")) {
            const server = decoded.split("@")[1];
            const [host, port] = server.split(":");
            return { host, port: parseInt(port) || 443, remark };
          }
        } catch {}
      }
    }
  } catch (e) {
    console.error("Parse error:", e);
  }
  return { host: null, port: null, remark: "" };
}

export function extractChannelSource(text, config, fallback = "") {
  const patterns = [
    /t\.me\/([\w+]{4,})/g,
    /@([\w+]{4,})/g,
    /#([\w+]{4,})/g,
    /channel[:\s]+([\w+]{4,})/gi
  ];

  const sources = [];

  // 1. Try to extract from text first
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      sources.push(match[1]);
    }
  }

  // 2. Try to extract from config itself (remark/ps)
  try {
    const type = detectType(config);
    let remark = "";
    if (type === "vmess") {
      const b64 = config.replace("vmess://", "").trim();
      const data = JSON.parse(atob(b64));
      remark = data.ps || "";
    } else {
      const hashPart = config.split("#")[1];
      if (hashPart) remark = decodeURIComponent(hashPart);
    }

    if (remark) {
      // Check if remark is just a username or contains one
      const cleanRemark = remark.replace(/^[@#]/, "").trim();
      if (/^[\w+]{4,}$/.test(cleanRemark)) {
        sources.push(cleanRemark);
      } else {
        for (const pattern of patterns) {
          const m = cleanRemark.match(pattern);
          if (m) m.forEach(found => sources.push(found.replace(/[#@]/g, "").replace("t.me/", "")));
        }
      }
    }
  } catch {}

  const uniqueSources = [...new Set(sources.map(s => s.replace(/^[@#]/, "")))];
  return uniqueSources.length > 0 ? uniqueSources[0] : fallback;
}

export async function fetchWithTimeout(url, options = {}, timeout = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

export async function testConfig(config) {
  const { host, port } = extractServer(config);
  if (!host) return {
    status: "error",
    message: "Cannot parse server",
    latency: -1,
    host: null,
    port: null,
    timestamp: new Date().toISOString()
  };

  const result = {
    host,
    port,
    ip: null,
    country: "Unknown",
    countryCode: "UN",
    tcp: false,
    dns: false,
    latency: -1,
    timestamp: new Date().toISOString()
  };

  // 1. DNS Check
  try {
    const dnsResp = await fetchWithTimeout(`https://cloudflare-dns.com/dns-query?name=${host}&type=A`, {
      headers: { "Accept": "application/dns-json" }
    }, 3000);
    const dnsData = await dnsResp.json();
    if (dnsData.Answer && dnsData.Answer.length > 0) {
      result.dns = true;
      result.ip = dnsData.Answer[0].data;
    }
  } catch (e) {}

  // 1.5 Geo-Location Check (if DNS succeeded)
  if (result.dns && result.ip) {
    try {
      // Use ip-api.com (free for non-commercial, 45 requests per minute)
      const geoResp = await fetchWithTimeout(`http://ip-api.com/json/${result.ip}`, {}, 2000).catch(() => null);
      if (geoResp) {
        const geoData = await geoResp.json();
        if (geoData.status === "success") {
          result.country = geoData.country || "Unknown";
          result.countryCode = geoData.countryCode || "UN";
        }
      }
    } catch (e) {}
  }

  // 2. TCP/HTTPS Check
  if (result.dns) {
    try {
      const start = Date.now();
      // Try HTTPS first
      let resp = await fetchWithTimeout(`https://${host}:${port}`, {
        method: "HEAD",
        cf: { cacheTtl: 0 }
      }, 5000).catch(() => null);

      // If HTTPS fails, try HTTP
      if (!resp) {
        resp = await fetchWithTimeout(`http://${host}:${port}`, {
          method: "HEAD",
          cf: { cacheTtl: 0 }
        }, 5000).catch(() => null);
      }

      const elapsed = Date.now() - start;
      if (resp) {
        result.tcp = true;
        result.latency = elapsed;
      }
    } catch (e) {}
  }

  result.status = result.tcp ? "active" : result.dns ? "dns_only" : "dead";
  result.message = result.tcp ? `Online - ${result.latency}ms` : result.dns ? "DNS OK, TCP failed" : "Offline";
  return result;
}

export function getBucket(type, hash) {
  const firstChar = String(hash || "").charAt(0).toLowerCase();
  let group = 1;

  if ("0123456".includes(firstChar)) group = 1;
  else if ("789abcd".includes(firstChar)) group = 2;
  else if ("efghijk".includes(firstChar)) group = 3;
  else if ("lmnopqr".includes(firstChar)) group = 4;
  else if ("stuvwxyz".includes(firstChar)) group = 5;
  else group = 1; // Default

  return `cfgs:${type}:${group}`;
}

export const ALL_BUCKETS = [];
['vless', 'vmess', 'trojan', 'ss'].forEach(t => {
  for (let i = 1; i <= 5; i++) ALL_BUCKETS.push(`cfgs:${t}:${i}`);
});
