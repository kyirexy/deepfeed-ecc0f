const ARCHIVE_URL = process.env.LIVE_DATA_URL || 'https://raw.githubusercontent.com/kyirexy/deepfeed/live-data/live.json';

const ALIASES = ['梦回甄嬛传', '梦回·甄嬛传'];
const STRONG = ['小游戏', '小程序', '小胖橘', '广州盈心', '北京爱谱雷', '墨麒麟', '三七互娱', '番外差事'];
const EXCLUDES = ['东阿阿胶', '阿胶', '广告片', '电视剧剪辑', '影视剪辑', '仿妆', '影视解说', '原班人马', '深宫曲', '甄嬛传电视剧'];

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

function isStrictlyRelevant(item) {
  if (item.relevanceMethod === 'entity_fingerprint_v3') return item.relevanceBucket === 'main' && Number(item.relevanceScore || 0) >= 70;
  const title = String(item.title || '').toLowerCase();
  const description = String(item.description || item.snippet || '').toLowerCase();
  const all = `${title} ${description}`;
  if (EXCLUDES.some(x => all.includes(x.toLowerCase()))) return false;
  for (const alias of ALIASES) {
    const key = alias.toLowerCase();
    const pos = title.indexOf(key);
    if (pos < 0) continue;
    const strong = STRONG.some(x => all.includes(x.toLowerCase()));
    if (pos <= 8 || (pos <= 28 && strong)) return true;
  }
  return false;
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, mock: false, error: 'Method not allowed' });
  try {
    const url = `${ARCHIVE_URL}${ARCHIVE_URL.includes('?') ? '&' : '?'}t=${Date.now()}`;
    const upstream = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'MiniGameOpinionWorkspace/1.1' },
      signal: AbortSignal.timeout(12000),
      cache: 'no-store',
    });
    if (!upstream.ok) throw new Error(`Archive HTTP ${upstream.status}`);
    const payload = await upstream.json();
    if (payload.mock !== false) return json(409, { ok: false, mock: false, error: 'mock:false validation failed' });
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const items = rawItems.filter(isStrictlyRelevant);
    return json(200, {
      ...payload,
      itemCount: items.length,
      rawItemCount: rawItems.length,
      filteredOut: rawItems.length - items.length,
      relevancePolicy: 'entity_fingerprint_v3_strict_public_view',
      items,
    });
  } catch (error) {
    return json(502, { ok: false, mock: false, error: error instanceof Error ? error.message : String(error) });
  }
};
