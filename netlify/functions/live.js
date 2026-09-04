const ARCHIVE_URL = process.env.LIVE_DATA_URL || 'https://raw.githubusercontent.com/kyirexy/deepfeed/live-data/live.json';

const ALIASES = ['梦回甄嬛传', '梦回·甄嬛传'];
const STRONG = ['小游戏', '小程序', '小胖橘', '广州盈心', '北京爱谱雷', '墨麒麟', '三七互娱', '番外差事'];
const EXCLUDES = ['东阿阿胶', '阿胶', '广告片', '电视剧剪辑', '影视剪辑', '仿妆', '影视解说', '原班人马', '深宫曲', '甄嬛传电视剧'];
const MAIN_MIN = 65;
const DISCOVERY_MIN = 28;

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'access-control-allow-origin': '*',
    },
    body: JSON.stringify(payload),
  };
}

function textOf(item) {
  const title = String(item.title || '').toLowerCase();
  const description = String(item.description || item.snippet || '').toLowerCase();
  return { title, description, all: `${title} ${description}` };
}

function isExcluded(item) {
  const { all } = textOf(item);
  return EXCLUDES.some(x => all.includes(x.toLowerCase()));
}

function isMain(item) {
  if (isExcluded(item)) return false;
  if (item.relevanceMethod === 'entity_fingerprint_v3') {
    return item.relevanceBucket === 'main' && Number(item.relevanceScore || 0) >= MAIN_MIN;
  }
  const { title, all } = textOf(item);
  for (const alias of ALIASES) {
    const key = alias.toLowerCase();
    const pos = title.indexOf(key);
    if (pos < 0) continue;
    const strong = STRONG.some(x => all.includes(x.toLowerCase()));
    if (pos <= 8 || (pos <= 28 && strong)) return true;
  }
  return false;
}

function isDiscovery(item) {
  if (isExcluded(item)) return false;
  if (item.relevanceMethod === 'entity_fingerprint_v3') {
    return item.relevanceBucket === 'quarantine' && Number(item.relevanceScore || 0) >= DISCOVERY_MIN;
  }
  const { title, description, all } = textOf(item);
  const aliasHit = ALIASES.some(a => title.includes(a.toLowerCase()) || description.includes(a.toLowerCase()));
  if (!aliasHit) return false;
  const strong = STRONG.some(x => all.includes(x.toLowerCase()));
  return strong || item.isRelevant === true || Number(item.relevanceScore || 0) >= DISCOVERY_MIN;
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','spm','from','source'].forEach(k => url.searchParams.delete(k));
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch { return String(value || ''); }
}

function stamp(item) {
  return Date.parse(item.lastSeenAt || item.collectedAt || item.publishedAt || item.firstSeenAt || 0) || 0;
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, mock: false, error: 'Method not allowed' });
  try {
    const url = `${ARCHIVE_URL}${ARCHIVE_URL.includes('?') ? '&' : '?'}t=${Date.now()}`;
    const upstream = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'MiniGameOpinionWorkspace/1.2-balanced' },
      signal: AbortSignal.timeout(12000),
      cache: 'no-store',
    });
    if (!upstream.ok) throw new Error(`Archive HTTP ${upstream.status}`);
    const payload = await upstream.json();
    if (payload.mock !== false) return json(409, { ok: false, mock: false, error: 'mock:false validation failed' });

    const rawMain = Array.isArray(payload.items) ? payload.items : [];
    const rawDiscovery = Array.isArray(payload.quarantineItems) ? payload.quarantineItems : [];
    const mainItems = rawMain.filter(isMain).map(item => ({
      ...item,
      pool: 'main',
      poolLabel: '高置信舆情',
      metricEligible: true,
    }));
    const discoveryItems = rawDiscovery.filter(isDiscovery).map(item => ({
      ...item,
      relevanceBucket: 'discovery',
      pool: 'discovery',
      poolLabel: '候选发现',
      metricEligible: false,
    }));

    const merged = new Map();
    for (const item of [...mainItems, ...discoveryItems]) {
      const key = normalizeUrl(item.url || item.sourceUrl || item.id);
      const old = merged.get(key);
      if (!old || (old.pool !== 'main' && item.pool === 'main') || stamp(item) > stamp(old)) merged.set(key, item);
    }
    const items = [...merged.values()].sort((a, b) => stamp(b) - stamp(a));

    return json(200, {
      ...payload,
      itemCount: items.length,
      highConfidenceCount: mainItems.length,
      discoveryCount: discoveryItems.length,
      metricItemCount: mainItems.length,
      rawMainCount: rawMain.length,
      rawDiscoveryCount: rawDiscovery.length,
      relevancePolicy: 'balanced_recall_v4_public_view',
      displayPolicy: 'main+discovery; metrics use main only',
      items,
      discoveryItems,
    });
  } catch (error) {
    return json(502, { ok: false, mock: false, error: error instanceof Error ? error.message : String(error) });
  }
};
