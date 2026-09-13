/* ============================================
   怪谈世界 · 百科  —  数据驱动前端逻辑
   数据源: ../data/  (terms.json / graph.json / articles.json / worldview.md / raw/*.txt)
   说明: 修改 JSON 文本后刷新页面即生效; 关键词链接由词条 name+aliases 自动生成。
   ============================================ */
"use strict";

const DATA_BASE = "../data/";
const $view = document.getElementById("view");
const $tip = document.getElementById("tooltip");
const $hint = document.querySelector(".sidebar-hint");

const state = { terms: [], articles: [], graph: null, termMap: null };

/* ---------------- 工具函数 ---------------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CAT = { concept: "概念", person: "人物", location: "地点", faction: "势力", creature: "生物", event: "事件", item: "器物", realm: "界", nation: "国家", region: "区域", centered: "核心", entity: "存在" };
const catName = c => CAT[c] || c || "词条";

function termById(id) { return state.terms.find(t => t.id === id) || null; }

/* 汉字大写数字 */
const CN_NUM = ["零","一","二","三","四","五","六","七","八","九","十"];
function cnNum(n) {
  if (n <= 10) return CN_NUM[n];
  if (n < 20) return "十" + (n % 10 ? CN_NUM[n % 10] : "");
  const t = Math.floor(n / 10), u = n % 10;
  return CN_NUM[t] + "十" + (u ? CN_NUM[u] : "");
}

/* ---------------- 数据加载 ---------------- */
async function loadData() {
  const [t, a, g] = await Promise.all([
    fetch(DATA_BASE + "terms.json").then(r => r.json()),
    fetch(DATA_BASE + "articles.json").then(r => r.json()),
    fetch(DATA_BASE + "graph.json").then(r => r.json())
  ]);
  state.terms = t; state.articles = a; state.graph = g;
  buildTermMap();
  if ($hint) $hint.textContent = state.terms.length + " 词条";
}

function buildTermMap() {
  const m = new Map(); // name / alias -> Set<id>
  for (const t of state.terms) {
    const keys = new Set([t.name, ...(t.aliases || [])]);
    for (const k of keys) { if (!k) continue; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(t.id); }
  }
  state.termMap = m;
}

/* 自动链接: 把文本中出现的词条名/别名转成链接; selfId 表示当前词条自身不再自链 */
function linkify(text, selfId) {
  const map = state.termMap;
  if (!map || !map.size) return esc(text);
  const hits = [];
  for (const [name, ids] of map) {
    if (!name || name.length < 2) continue;
    let i = text.indexOf(name);
    while (i >= 0) { hits.push({ s: i, e: i + name.length, name, ids: [...ids] }); i = text.indexOf(name, i + name.length); }
  }
  if (!hits.length) return esc(text);
  hits.sort((a, b) => a.s - b.s || b.e - a.e);
  const picked = []; let last = -1;
  for (const h of hits) { if (h.s < last) continue; picked.push(h); last = h.e; }
  let out = "", pos = 0;
  for (const h of picked) {
    out += esc(text.slice(pos, h.s));
    const id = h.ids[0];
    out += (id === selfId)
      ? esc(h.name)
      : `<a href="#/term/${encodeURIComponent(id)}">${esc(h.name)}</a>`;
    pos = h.e;
  }
  out += esc(text.slice(pos));
  return out;
}

/* 轻量模糊搜索评分(逐字有序匹配) */
function fuzzyScore(text, q) {
  if (!q) return 0;
  text = text.toLowerCase(); q = q.toLowerCase();
  if (text.includes(q)) return 200 + (100 / Math.min(text.length, 30));
  let qi = 0, score = 0, streak = 0, last = -2;
  for (let i = 0; i < text.length && qi < q.length; i++) {
    if (text[i] === q[qi]) { streak = (i === last + 1) ? streak + 1 : 0; last = i; qi++; score += 1 + streak * 1.5; }
  }
  return qi < q.length ? 0 : score;
}
function searchTerms(q) {
  if (!q.trim()) return [];
  return state.terms
    .map(t => {
      const hay = t.aliases && t.aliases.length ? [t.name, ...t.aliases].join(" ") : t.name;
      return { t, s: fuzzyScore(hay, q) + fuzzyScore(t.summary || "", q) * 0.5 };
    })
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 30)
    .map(x => x.t);
}

/* ---------------- Tooltip ---------------- */
const tip = {
  cur: null,
  show(x, y, html) {
    if ($tip.innerHTML === html && !$tip.hidden) { tip.move(x, y); return; }
    $tip.innerHTML = html; $tip.hidden = false; tip.move(x, y);
  },
  move(x, y) {
    const r = $tip.getBoundingClientRect();
    let px = x + 18, py = y + 18;
    if (px + r.width > innerWidth - 8) px = x - r.width - 14;
    if (py + r.height > innerHeight - 8) py = y - r.height - 10;
    $tip.style.left = px + "px"; $tip.style.top = py + "px";
  },
  hide() {
    if (!$tip.hidden) { $tip.hidden = true; tip.cur = null; }
  }
};

/* ---------------- 路由 ---------------- */
function router() {
  const raw = location.hash.replace(/^#\/?/, "");
  const seg = raw.split("/").filter(Boolean);
  const view = seg[0] || "home";
  let active = view;
  if (view === "home") renderHome();
  else if (view === "library") renderLibrary();
  else if (view === "term" && seg[1]) renderTerm(decodeURIComponent(seg[1]));
  else if (view === "article" && seg[1]) renderReader(decodeURIComponent(seg[1]));
  else if (view === "world") renderWorld();
  else { active = "home"; renderHome(); }
  document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.route === (active === "term" || active === "article" ? "library" : active)));
  tip.hide(); window.scrollTo(0, 0);
}
window.addEventListener("hashchange", router);

/* ---------------- 首页 · 立体知识图谱 ---------------- */
function renderHome() {
  const g = state.graph;
  $view.innerHTML = `
    <section class="home">
      <canvas class="home-canvas" id="gk"></canvas>
      <div class="home-head">
        <h1>怪谈</h1>
        <div class="home-en">The World of Strange Tales</div>
      </div>
      <div class="home-foot">鼠标<b>悬停</b>节点查看简介 · <b>点击</b>进入词条详情</div>
      <div class="home-hint">知识图谱 · ${g ? g.nodes.length : 0} 节点 / ${g ? g.relations.length : 0} 关系</div>
    </section>`;
  if (g) initGraph(document.getElementById("gk"));
}

function initGraph(canvas) {
  const ctx = canvas.getContext("2d");
  const g = state.graph;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  let W = 0, H = 0, cx = 0, cy = 0;
  const mouse = { x: -9999, y: -9999 };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NCOL = { realm: "#5f96ff", nation: "#e6b453", faction: "#8a6ae0", region: "#3fc0b4", location: "#5daa90", creature: "#7fb0ff", centered: "#f2f5ff", person: "#bbcfff", entity: "#9fd0e8" };
  const center = g.nodes.find(nd => nd.id === g.meta.center_id) || g.nodes[0];

  // 邻接(一阶)
  const adj = {};
  for (const r of g.relations) {
    (adj[r.source] = adj[r.source] || []).push(r.target);
    (adj[r.target] = adj[r.target] || []).push(r.source);
  }
  const nearSet = new Set([center.id, ...(adj[center.id] || [])]);
  const relById = {};
  for (const r of g.relations) {
    (relById[r.source] = relById[r.source] || []).push(r);
    (relById[r.target] = relById[r.target] || []).push(r);
  }

  const nodes = [];
  let T = 0, offset = { x: 0, y: 0 };

  function seed(s) { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h || 1; }

  function layout() {
    nodes.length = 0;
    const R1 = Math.min(W, H) * 0.44, R2 = Math.min(W, H) * 0.62;
    let i1 = 0, i2 = 0;
    const n1 = Math.max(1, g.nodes.length - (nearSet.size - 1));
    for (const nd of g.nodes) {
      if (nd.id === center.id) {
        nodes.push({ n: nd, isC: true, ang: NaN, R: 0, spd: 0, jitter: 0, dep: 0, r: Math.min(W, H) * 0.058, x: cx, y: cy });
        continue;
      }
      const s = seed(nd.id);
      const near = nearSet.has(nd.id);
      const R = near ? R1 : R2;
      const base = near
        ? (i1 / Math.max(1, nearSet.size - 1)) * Math.PI * 2 + (s % 13) * 0.11
        : (i2 / Math.max(1, n1)) * Math.PI * 2 + (s % 17) * 0.09;
      nodes.push({
        n: nd, isC: false,
        ang: base, R: R + ((s % 197) / 197 - 0.5) * R * 0.16,
        spd: reduced ? 0 : (0.0005 + (s % 13) * 0.00007) * (near ? 1.18 : 0.82),
        jitter: ((s % 61) - 30) * 0.0018,
        dep: ((s % 5) - 2) / 2.2,
        r: 10 + (s % 5) * 1.9,
        base,
        x: cx, y: cy
      });
      if (near) i1++; else i2++;
    }
  }

  function resize() {
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = H / 2;
    layout();
  }

  function project(nd) {
    const a0 = nd.isC ? 0 : nd.base + T * nd.spd + nd.jitter * T;
    if (nd.isC) { nd.x = cx + offset.x; nd.y = cy + offset.y + offset.y * 0.1; return; }
    const rr = nd.R / (1 + nd.dep * 0.12);           // 深度轻微改变轨道半径
    nd._z = nd.dep;
    nd._s = nd.r * (1 + nd.dep * 0.34);              // 近大远小
    nd._al = Math.min(1, 0.5 + nd.dep * 0.32);
    const rx = Math.min(rr * (1 + nd.dep * 0.10), W * 0.47);   // 椭圆轨道: 横向
    const ry = Math.min(rr * 0.94, H * 0.485);                 // 椭圆轨道: 纵向拉满
    nd.x = cx + Math.cos(a0) * rx + offset.x + Math.sin(a0) * offset.y * 0.25;
    nd.y = cy + Math.sin(a0) * ry + nd.dep * H * 0.05 + offset.y;
  }

  function hitTest(px, py) {
    let best = null, bd = 1e9;
    for (const nd of nodes) {
      const rr = (nd.isC ? nd.r : nd._s) + 9;
      const dx = px - nd.x, dy = py - nd.y, d = dx * dx + dy * dy;
      if (d < rr * rr && d < bd) { bd = d; best = nd; }
    }
    return best;
  }

  function tipHTML(nd) {
    const rels = relById[nd.n.id] || [];
    const relTxt = rels.length
      ? `<div class="rel">${rels.slice(0, 4).map(r => {
          const other = r.source === nd.n.id ? r.target : r.source;
          const o = state.terms.find(t => t.id === other);
          return `<span>${esc(r.type || "关联")} · <b>${esc(o ? o.name : other)}</b></span>`;
        }).join("")}</div>`
      : "";
    return `
      <h4>${esc(nd.n.name)} <span class="cat">${catName(nd.n.category).toUpperCase()}</span></h4>
      <p>${esc(nd.n.summary || "暂无简介")}</p>
      ${relTxt}
      <div class="go">点击进入词条 →</div>`;
  }

  function draw() {
    ensureSize();
    ctx.clearRect(0, 0, W, H);
    // 视差: 鼠标带动整体微移
    const tx = (mouse.x - W / 2) / 70, ty = (mouse.y - H / 2) / 70;
    offset.x += (tx - offset.x) * 0.05; offset.y += (ty - offset.y) * 0.05;

    for (const nd of nodes) project(nd);

    const hx = mouse.x, hy = mouse.y;
    const hov = hitTest(hx, hy);

    const bySorted = nodes.slice().sort((a, b) => (a.dep || 0) - (b.dep || 0));

    // 背景星点
    ctx.fillStyle = "rgba(160,185,255,.5)";
    const starN = Math.floor(W * H / 16000);
    for (let i = 0; i < starN; i++) {
      const sx = (i * 877 + 31) % W, sy = (i * 613 + 17) % H;
      ctx.globalAlpha = 0.06 + (i % 5) * 0.03;
      ctx.fillRect(sx, sy, 1.3, 1.3);
    }
    ctx.globalAlpha = 1;

    // 连线(按深度粗略分前后)
    for (const rel of g.relations) {
      const a = nodes.find(nd => nd.n.id === rel.source), b = nodes.find(nd => nd.n.id === rel.target);
      if (!a || !b) continue;
      const hot = hov && (hov.n.id === rel.source || hov.n.id === rel.target);
      const al = hot ? 0.85 : 0.22 + (a.dep + b.dep) * 0.05;
      ctx.strokeStyle = hot ? `rgba(140,170,255,${al})` : `rgba(140,170,255,${al})`;
      ctx.lineWidth = hot ? 1.6 : 1;
      ctx.setLineDash(hot ? [4, 5] : []);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      // 关系标签(仅在 hover 相关时显示)
      if (hot) {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        ctx.fillStyle = "rgba(200,215,255,.9)";
        ctx.font = '11px "Microsoft YaHei",sans-serif';
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(rel.type, mx, my - 8);
      }
    }

    // 节点(由远到近)
    for (const nd of bySorted) {
      const isC = nd.isC;
      const r = isC ? nd.r : nd._s;
      const al = isC ? 1 : nd._al;
      const dim = hov && hov !== nd;
      const isHov = hov === nd;
      const rad = isHov ? r * 1.18 : r;
      ctx.globalAlpha = dim ? 0.2 : al;

      if (isC) {
        const grad = ctx.createRadialGradient(nd.x - rad * 0.25, nd.y - rad * 0.25, 2, nd.x, nd.y, rad + 26);
        grad.addColorStop(0, "rgba(240,244,255,.96)");
        grad.addColorStop(0.45, "rgba(150,175,255,.92)");
        grad.addColorStop(1, "rgba(79,141,255,.28)");
        ctx.shadowColor = "rgba(140,175,255,.85)"; ctx.shadowBlur = 40;
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(nd.x, nd.y, rad, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#0b101d";
        ctx.font = `700 ${Math.round(rad * 0.6)}px "Songti SC",serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(nd.n.name, nd.x, nd.y + 1);
        ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(nd.x, nd.y, rad + 26, 0, Math.PI * 2); ctx.stroke();
      } else {
        const col = NCOL[nd.n.category] || "#9aa8c6";
        // 立体球: 径向渐变高光
        const grad = ctx.createRadialGradient(nd.x - rad * 0.35, nd.y - rad * 0.4, rad * 0.15, nd.x, nd.y, rad);
        grad.addColorStop(0, "rgba(255,255,255,.6)");
        grad.addColorStop(0.3, col);
        grad.addColorStop(1, "rgba(8,12,22,.85)");
        ctx.shadowColor = col; ctx.shadowBlur = isHov ? 26 : (rad * 0.7 + 6);
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(nd.x, nd.y, rad, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        if (rad > 11 && nd._al > 0.5) {
          ctx.fillStyle = "rgba(8,12,22,.92)";
          ctx.font = `600 ${Math.max(10, Math.round(rad * 0.6))}px "Microsoft YaHei",sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(nd.n.name.length > 5 ? nd.n.name.slice(0, 5) : nd.n.name, nd.x, nd.y + 1);
        }
      }
      ctx.globalAlpha = 1;
    }

    // 悬停小窗(仅在内容变化时刷新)
    if (hov) tip.show(hov.x, hov.y - 8, tipHTML(hov));
    else if (!$tip.hidden) tip.hide();

    if (!reduced) T += 1 / 60;
    requestAnimationFrame(draw);
  }

  function onMove(e) {
    const p = toLocal(e);
    mouse.x = p.x; mouse.y = p.y;
    if (!$tip.hidden) tip.move(e.clientX, e.clientY);
  }
  function toLocal(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }
  addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", () => { mouse.x = -9999; mouse.y = -9999; tip.hide(); });
  canvas.addEventListener("click", e => {
    const p = toLocal(e);
    const nd = hitTest(p.x, p.y);
    if (nd) location.hash = "#/term/" + nd.n.id;
  });
  function ensureSize() {
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (cw && ch && (cw !== W || ch !== H)) { resize(); return true; }
    return false;
  }
  addEventListener("resize", resize);
  resize();
  draw();
  (function loop() { ensureSize(); requestAnimationFrame(loop); })();
}

/* ---------------- 图书馆 ---------------- */
function renderLibrary() {
  $view.innerHTML = `
    <section class="library">
      <div class="library-bg"></div>
      <div class="library-inner">
        <div class="library-top">
          <h1>怪谈图书馆</h1>
          <div class="sub">检索词条，或翻阅怪谈世界观目前的故事原文</div>
        </div>
        <div class="search-box" role="search">
          <span class="s-ico">⌕</span>
          <input id="gkQ" type="text" placeholder="搜索你感兴趣的内容或名词…" autocomplete="off">
          <span class="s-count" id="gkC"></span>
        </div>
        <div class="search-results" id="gkRes"></div>
        <div class="stories">
          <div class="stories-h">怪谈原文 <span class="en">SOURCES · ${state.articles.length}</span></div>
          <div class="art-grid" id="gkArts"></div>
        </div>
      </div>
    </section>`;

  const $q = document.getElementById("gkQ");
  const $res = document.getElementById("gkRes");
  const $cnt = document.getElementById("gkC");

  function renderResults(list) {
    if (!list.length) { $cnt.textContent = "0 结果"; $res.innerHTML = ""; return; }
    $cnt.textContent = list.length + " 结果";
    $res.innerHTML = `<div class="sr-list">${list.map(t => `
      <button class="sr-item" data-id="${esc(t.id)}" tabindex="0">
        <span class="nm">${esc(t.name)}</span>
        <span class="tag">${catName(t.category)}</span>
        <span class="sum">${esc(t.summary || "")}</span>
      </button>`).join("")}</div>`;
    $res.querySelectorAll(".sr-item").forEach(b => {
      const go = () => location.hash = "#/term/" + b.dataset.id;
      b.addEventListener("click", go);
      b.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    });
  }

  function onInput() {
    const v = $q.value.trim();
    if (!v) { renderResults(coreNodes()); return; }
    renderResults(searchTerms(v));
  }
  function coreNodes() {
    const ids = state.graph ? state.graph.nodes.map(n => n.id) : [];
    return ids.map(id => termById(id)).filter(Boolean);
  }

  $q.addEventListener("input", onInput);
  const $arts = document.getElementById("gkArts");
  $arts.innerHTML = state.articles.map(a => `
    <button class="art-card" data-id="${esc(a.id)}" tabindex="0">
      <div class="tip">${esc(a.excerpt || "")}</div>
      <div class="t">${esc(a.title)}</div>
      <div class="e">${esc(a.excerpt || "")}</div>
      <div class="tg">${(a.tags || []).map(x => `<span class="tag">${esc(x)}</span>`).join("")}</div>
      <div class="chaps">共 ${(a.chapters || []).length} 节</div>
    </button>`).join("");
  $arts.querySelectorAll(".art-card").forEach(b => {
    const go = () => location.hash = "#/article/" + b.dataset.id;
    b.addEventListener("click", go);
    b.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  });
  onInput();
}

/* ---------------- 词条页 ---------------- */
function renderTerm(id) {
  const t = termById(id);
  if (!t) {
    $view.innerHTML = `<div class="empty-state"><div class="code">404</div><div>未找到该词条（${esc(id)}）</div><a href="#/library">返回图书馆</a></div>`;
    return;
  }
  const rel = (t.related || []).map(rid => termById(rid)).filter(Boolean);
  const srcs = (t.sources || []).map(s => state.articles.find(a => (a.id + "").endsWith(String(s)))).filter(Boolean);
  const paras = (t.detail || "").split(/\n+/).filter(p => p.trim());
  $view.innerHTML = `
    <article class="term">
      <div class="term-top">
        <div class="crumb"><a href="#/">首页</a>&nbsp;/&nbsp;<a href="#/library">图书馆</a>&nbsp;/&nbsp;词条</div>
        <h1>${esc(t.name)}</h1>
        ${t.aliases && t.aliases.length ? `<div class="aliases">别称：${t.aliases.map(esc).join(" · ")}</div>` : ""}
        <div class="cat-line"><span class="tag tag--paper">${catName(t.category)}</span><span class="tag tag--paper">词条 ID · ${esc(t.id)}</span></div>
        <div class="sum">${esc(t.summary || "")}</div>
      </div>
      <div class="term-body">
        <h2>词条介绍</h2>
        ${paras.length ? paras.map(p => `<p class="term-detail">${linkify(p.trim(), t.id)}</p>`).join("") : `<p class="term-detail">${esc(t.detail || "暂无介绍")}</p>`}
        ${rel.length ? (() => {
          const mk = rel.map(r => `<a class="link-chip" href="#/term/${encodeURIComponent(r.id)}">${esc(r.name)}</a>`).join("");
          return `<h2>相关词条</h2><div class="links-box">${mk}</div>`;
        })() : ""}
        ${srcs.length ? (() => {
          const mk = srcs.map(a => `<a class="link-chip" href="#/article/${encodeURIComponent(a.id)}">原文 · ${esc(a.title)}</a>`).join("");
          return `<div class="src-note">对应原文：${mk}</div>`;
        })() : ""}
      </div>
    </article>`;
}

/* ---------------- 阅读器 ---------------- */
function renderReader(articleId) {
  const a = state.articles.find(x => x.id === articleId);
  if (!a) {
    $view.innerHTML = `<div class="empty-state"><div class="code">404</div><div>未找到该篇原文</div><a href="#/library">返回图书馆</a></div>`;
    return;
  }
  let pages = [];
  let cur = 0;

  $view.innerHTML = `
    <section class="reader-wrap">
      <div class="reader-bar">
        <span class="r-title">${esc(a.title)}</span>
        <span class="r-part" id="gkPart">载入中…</span>
        <label class="r-jump">跳转
          <select id="gkSel" aria-label="跳转章节"></select>
        </label>
        <button id="gkBack">返回图书馆</button>
      </div>
      <div class="reader-card">
        <div id="gkPage"></div>
        <div class="pager">
          <button id="gkPrev" type="button">← 上一节</button>
          <span class="pg" id="gkIdx"></span>
          <button id="gkNext" type="button">下一节 →</button>
        </div>
      </div>
      <div class="reader-tip">版权说明 · 本文内容仅供站内阅读，已禁用复制与下载</div>
    </section>`;

  const $part = document.getElementById("gkPart");
  const $sel = document.getElementById("gkSel");
  const $page = document.getElementById("gkPage");
  const $idx = document.getElementById("gkIdx");
  const $prev = document.getElementById("gkPrev");
  const $next = document.getElementById("gkNext");
  document.getElementById("gkBack").addEventListener("click", () => location.hash = "#/library");

  $view.closest("#main").addEventListener("contextmenu", e => { if (e.target.closest(".reader-wrap")) e.preventDefault(); });
  document.addEventListener("copy", e => { if (e.target.closest(".reader-wrap")) e.preventDefault(); }, true);

  /* 按 chapters[start_marker] 切分; 严格按序, 顺序异常自动降级为全文 */
  function splitPages(txt) {
    const chs = a.chapters || [];
    const arr = [];
    const pos = [];
    for (let i = 0; i < chs.length; i++) {
      const mk = chs[i].start_marker;
      if (!mk) { pos.push(-1); continue; }
      pos.push(txt.indexOf(mk));
    }
    for (let i = 0; i < chs.length; i++) {
      const s = pos[i];
      if (s < 0) continue;
      let e = txt.length;
      for (let j = i + 1; j < chs.length; j++) if (pos[j] > s) { e = pos[j]; break; }
      arr.push({ part: chs[i].part || "", title: chs[i].title || "", text: txt.slice(s, e) });
    }
    if (!arr.length) arr.push({ part: "全文", title: a.title, text: txt });
    return arr;
  }

  /* 章节显示名: 优先 part, 否则"第x节" */
  function pageLabel(pg, i) {
    const p = pg.part || ("第" + (i + 1) + "节");
    const t = pg.title;
    return t && t !== p ? p + " · " + t : p;
  }

  function render() {
    const pg = pages[cur];
    $part.textContent = pg ? pageLabel(pg, cur) : "";
    $idx.textContent = (cur + 1) + " / " + pages.length;
    $prev.disabled = cur <= 0; $next.disabled = cur >= pages.length - 1;
    $sel.value = cur;
    if (!pg) { $page.innerHTML = `<p>本章节暂未找到内容。</p>`; return; }
    $page.innerHTML = `
      <div class="r-ch-head">
        <h1>${esc(pg.title || pg.part || a.title)}</h1>
        <div class="r-meta">${esc(pg.part || a.title)} · 第 ${cur + 1} / ${pages.length} 节</div>
      </div>
      <div class="reader-body">${linkify(pg.text)}</div>`;
  }

  fetch("../" + a.source_file, { cache: "no-store" })
    .then(r => { if (!r.ok) throw 0; return r.text(); })
    .then(txt => {
      txt = (txt || "").replace(/\r/g, "");
      pages = splitPages(txt);
      $sel.innerHTML = pages.map((p, i) => `<option value="${i}">${esc(pageLabel(p, i))}</option>`).join("");
      $sel.addEventListener("change", () => { cur = +$sel.value; render(); window.scrollTo(0, 0); });
      $prev.addEventListener("click", () => { if (cur > 0) { cur--; render(); window.scrollTo(0, 0); } });
      $next.addEventListener("click", () => { if (cur < pages.length - 1) { cur++; render(); window.scrollTo(0, 0); } });
      render();
    })
    .catch(() => {
      $page.innerHTML = `<div class="err-note"><h2>原文加载失败</h2><p>未能读取 <code>${esc(a.source_file)}</code>。请确认该文本存在，并确保通过本地服务器或部署后访问（直接双击 HTML 的 file:// 模式无法读取数据）。</p></div>`;
      $part.textContent = "加载失败"; $idx.textContent = "";
    });
}

/* ---------------- 世界观 ---------------- */
async function renderWorld() {
  $view.innerHTML = `
    <section class="world"><div class="world-inner">
      <h1>了解世界观</h1><div class="line"></div>
      <div id="gkW"></div>
    </div></section>`;
  const $w = document.getElementById("gkW");
  try {
    const r = await fetch(DATA_BASE + "worldview.md");
    if (!r.ok) throw 0;
    const md = await r.text();
    let body = md.replace(/^---[\s\S]*?---\s*/m, "");          // 剥离文件头元数据
    body = body.replace(/^#.*\n/m, "");                         // 剥离一级标题
    body = body.split(/\r?\n/).filter(l => !/内容由AI生成|仅供参考|本文由AI生成/.test(l)).join("\n"); // 清理AI说明行
    const paras = body.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    $w.innerHTML = paras.map(p => `<p class="wp">${linkify(p)}</p>`).join("");
    if (!paras.length) $w.innerHTML = `<p class="wp">暂无内容。</p>`;
  } catch (e) {
    $w.innerHTML = `<div class="err-note"><h2>加载失败</h2><p>请通过本地服务器或部署后访问本站（file:// 模式无法读取数据文件）。</p></div>`;
  }
}

/* ---------------- 启动 ---------------- */
(async function boot() {
  try {
    await loadData();
  } catch (e) {
    $view.innerHTML = `<div class="err-note">
      <h2>数据加载失败</h2>
      <p>当前可能是以 <code>file://</code> 方式直接打开了 HTML，浏览器禁止网页读取本地 JSON 文件。</p>
      <p>请双击运行项目根目录的 <code>start_server.bat</code>，然后访问 <code>http://localhost:8000/output/</code>；或将整个 <code>D:\\gt_library</code> 上传到任意静态托管平台。</p>
    </div>`;
    return;
  }
  router();
})();
