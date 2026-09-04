const fs = require('fs');
const path = require('path');

const root = process.cwd();
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html
  .replaceAll('潮汐 · 小游戏舆情 AI 工作台 Live Beta', '小游戏舆情工作台 · 公开舆情与 AI 分析')
  .replaceAll('潮汐 · 小游戏舆情 AI 工作台', '小游戏舆情工作台')
  .replaceAll('潮汐 · 舆情 AI', '小游戏舆情工作台')
  .replaceAll('<div class="logo">潮</div>', '<div class="logo">舆</div>')
  .replaceAll('Mini-game intelligence workspace', 'Public-source intelligence workspace')
  .replaceAll('潮汐', '小游戏舆情工作台');

const actionsMarker = '<div class="actions">';
if (html.includes(actionsMarker) && !html.includes('href="/solution.html"')) {
  html = html.replace(
    actionsMarker,
    `${actionsMarker}<a class="ghost-btn" href="/solution.html" style="text-decoration:none">方案说明</a>`
  );
}

const signalNote = '<div class="signal-policy" style="margin:0 0 18px;padding:12px 14px;border:1px solid var(--border);border-radius:14px;background:var(--input);color:var(--muted);font-size:12px;line-height:1.65"><strong style="color:var(--text)">信源策略已升级：</strong>可信直达 / Feed 优先；网页搜索仅用于精确实体发现。标题无关、只在摘要或推荐词中出现游戏名的结果进入隔离区，不计入主舆情统计。 <a href="/solution.html" style="color:var(--primary2);text-decoration:none">查看方案</a></div>';
const mainMarker = '<main>';
if (html.includes(mainMarker) && !html.includes('class="signal-policy"')) {
  html = html.replace(mainMarker, `${mainMarker}${signalNote}`);
}

fs.writeFileSync(path.join(dist, 'index.html'), html, 'utf8');
fs.copyFileSync(path.join(root, 'solution.html'), path.join(dist, 'solution.html'));
console.log('Built public site in dist/');
