const ARCHIVE_URL = process.env.LIVE_DATA_URL || 'https://raw.githubusercontent.com/kyirexy/deepfeed/live-data/live.json';

const PLATFORM_DOMAINS = {
  douyin: { label: '抖音', domains: ['douyin.com'] },
  xiaohongshu: { label: '小红书', domains: ['xiaohongshu.com'] },
  bilibili: { label: 'B站', domains: ['bilibili.com', 'b23.tv'] },
  taptap: { label: 'TapTap', domains: ['taptap.cn', 'taptap.com'] },
  wechat: { label: '微信公众号', domains: ['mp.weixin.qq.com'] },
  zhihu: { label: '知乎', domains: ['zhihu.com'] },
  tieba: { label: '贴吧', domains: ['tieba.baidu.com'] },
  weibo: { label: '微博', domains: ['weibo.com'] },
  game_media: { label: '游戏媒体', domains: ['9game.cn', '18183.com', '4399.com', '3dmgame.com'] },
  web: { label: '新闻/网页', domains: [] },
};
const ALIASES = ['梦回甄嬛传', '梦回·甄嬛传'];
const STRONG = ['小游戏', '小程序', '小胖橘', '广州盈心', '北京爱谱雷', '墨麒麟', '三七互娱', '番外差事'];
const EXCLUDES = ['东阿阿胶', '阿胶', '广告片', '电视剧剪辑', '影视剪辑', '仿妆', '影视解说', '原班人马', '深宫曲', '甄嬛传电视剧'];
const MAIN_MIN = 65;
const DISCOVERY_MIN = 28;

function json(statusCode, payload) {
  return { statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, max-age=0', 'access-control-allow-origin': '*' }, body: JSON.stringify(payload) };
}
function hostOf(value) { try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } }
function inferPlatform(item) {
  const host = hostOf(item.url || item.sourceUrl || '');
  for (const [key, spec] of Object.entries(PLATFORM_DOMAINS)) {
    if (spec.domains.some(d => host === d || host.endsWith(`.${d}`))) return { key, label: spec.label };
  }
  const raw = String(item.platform || item.platformLabel || item.source || '').toLowerCase();
  for (const [key, spec] of Object.entries(PLATFORM_DOMAINS)) {
    if (raw.includes(spec.label.toLowerCase()) || raw.includes(key)) return { key, label: spec.label };
  }
  return { key: 'web', label: '新闻/网页' };
}
function withinRange(item, timeRange) {
  if (timeRange === 'all') return true;
  const days = timeRange === 'day' ? 1 : timeRange === 'month' ? 31 : timeRange === 'year' ? 366 : null;
  if (!days) return true;
  const candidate = item.publishedAt || item.firstSeenAt || item.discoveredAt || item.lastSeenAt;
  if (!candidate) return true;
  const stamp = Date.parse(candidate);
  return !Number.isFinite(stamp) || Date.now() - stamp <= days * 86400000;
}
function excluded(item) {
  const text = `${item.title || ''} ${item.description || item.snippet || ''}`.toLowerCase();
  return EXCLUDES.some(x => text.includes(x.toLowerCase()));
}
function legacyMain(item) {
  if (excluded(item)) return false;
  const title = String(item.title || '').toLowerCase();
  const all = `${title} ${item.description || item.snippet || ''}`.toLowerCase();
  for (const alias of ALIASES) {
    const key = alias.toLowerCase();
    const pos = title.indexOf(key);
    if (pos < 0) continue;
    const strong = STRONG.some(x => all.includes(x.toLowerCase()));
    if (pos <= 8 || (pos <= 28 && strong)) return true;
  }
  return false;
}
function legacyDiscovery(item) {
  if (excluded(item)) return false;
  const title = String(item.title || '').toLowerCase();
  const description = String(item.description || item.snippet || '').toLowerCase();
  const all = `${title} ${description}`;
  const aliasHit = ALIASES.some(a => title.includes(a.toLowerCase()) || description.includes(a.toLowerCase()));
  if (!aliasHit) return false;
  return STRONG.some(x => all.includes(x.toLowerCase())) || item.isRelevant === true || Number(item.relevanceScore || 0) >= DISCOVERY_MIN;
}
function poolOf(item, fallback) {
  if (item.relevanceMethod === 'entity_fingerprint_v3') {
    if (item.relevanceBucket === 'main' && Number(item.relevanceScore || 0) >= MAIN_MIN) return 'main';
    if (['quarantine','discovery'].includes(item.relevanceBucket) && Number(item.relevanceScore || 0) >= DISCOVERY_MIN) return 'discovery';
    return null;
  }
  if (fallback === 'main' && legacyMain(item)) return 'main';
  if (fallback === 'discovery' && legacyDiscovery(item)) return 'discovery';
  return null;
}
function stamp(item) { return Date.parse(item.lastSeenAt || item.collectedAt || item.publishedAt || item.firstSeenAt || 0) || 0; }

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, mock: false, error: 'Method not allowed' });
  const params = event.queryStringParameters || {};
  const q = String(params.q || '').trim();
  const platform = String(params.platform || 'all').trim();
  const pool = ['all','main','discovery'].includes(String(params.pool || 'all')) ? String(params.pool || 'all') : 'all';
  const timeRange = ['day', 'month', 'year', 'all'].includes(String(params.time_range || 'month')) ? String(params.time_range || 'month') : 'month';
  const limit = Math.max(1, Math.min(100, Number(params.limit || 30)));
  if (q.length < 2 || q.length > 120) return json(400, { ok: false, error: 'q must contain 2-120 characters' });
  if (platform !== 'all' && !PLATFORM_DOMAINS[platform]) return json(400, { ok: false, error: 'Unsupported platform' });
  const started = Date.now();
  try {
    const url = `${ARCHIVE_URL}${ARCHIVE_URL.includes('?') ? '&' : '?'}t=${Date.now()}`;
    const upstream = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'MiniGameOpinionWorkspaceSearch/1.2-balanced' }, signal: AbortSignal.timeout(12000), cache: 'no-store' });
    if (!upstream.ok) throw new Error(`Archive HTTP ${upstream.status}`);
    const payload = await upstream.json();
    if (payload.mock !== false) throw new Error('mock:false validation failed');

    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = [];
    for (const item of Array.isArray(payload.items) ? payload.items : []) {
      const itemPool = poolOf(item, 'main');
      if (itemPool) rows.push({ ...item, _pool: itemPool });
    }
    for (const item of Array.isArray(payload.quarantineItems) ? payload.quarantineItems : []) {
      const itemPool = poolOf(item, 'discovery');
      if (itemPool) rows.push({ ...item, _pool: itemPool });
    }

    const results = rows
      .filter(item => pool === 'all' || item._pool === pool)
      .filter(item => {
        const inferred = inferPlatform(item);
        if (platform !== 'all' && inferred.key !== platform) return false;
        if (!withinRange(item, timeRange)) return false;
        const haystack = [item.title, item.description, item.snippet, item.summary, item.source, inferred.label].filter(Boolean).join(' ').toLowerCase();
        return tokens.every(t => haystack.includes(t));
      })
      .sort((a, b) => {
        if (a._pool !== b._pool) return a._pool === 'main' ? -1 : 1;
        const scoreDiff = Number(b.relevanceScore || 0) - Number(a.relevanceScore || 0);
        return scoreDiff || stamp(b) - stamp(a);
      })
      .slice(0, limit)
      .map(item => {
        const inferred = inferPlatform(item);
        return {
          title: item.title || '无标题',
          url: item.url || item.sourceUrl || '',
          snippet: item.description || item.snippet || item.summary || '',
          publishedAt: item.publishedAt || null,
          firstSeenAt: item.firstSeenAt || null,
          lastSeenAt: item.lastSeenAt || null,
          platform: inferred.key,
          platformLabel: inferred.label,
          accessLevel: item.accessLevel || item.dataLevel || '搜索发现',
          provider: item.provider || item.searchProvider || '分钟归档',
          relevanceScore: item.relevanceScore ?? null,
          pool: item._pool,
          poolLabel: item._pool === 'main' ? '高置信舆情' : '候选发现',
        };
      });

    const highConfidenceCount = rows.filter(x => x._pool === 'main').length;
    const discoveryCount = rows.filter(x => x._pool === 'discovery').length;
    return json(200, {
      ok: true,
      mock: false,
      provider: 'minute-archive-balanced',
      query: q,
      platform,
      pool,
      timeRange,
      resultCount: results.length,
      highConfidenceCount,
      discoveryCount,
      archiveGeneratedAt: payload.generatedAt || null,
      elapsedMs: Date.now() - started,
      results,
    });
  } catch (error) {
    return json(502, { ok: false, mock: false, error: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - started });
  }
};
