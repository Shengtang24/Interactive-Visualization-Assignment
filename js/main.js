/* global d3 */

const App = (() => {
  const DATA_URL = "./emissions.json";

  /** 政策/宏观事件：点击后聚焦到 [year−pad, year+pad] 与全局年份范围求交 */
  const POLICY_EVENTS = [
    { year: 1997, label: "京都议定书通过", padYears: 4 },
    { year: 2005, label: "京都议定书生效", padYears: 5 },
    { year: 2008, label: "全球金融危机", padYears: 3 },
    { year: 2015, label: "巴黎协定通过", padYears: 4 },
    { year: 2016, label: "巴黎协定生效", padYears: 3 },
  ];

  const el = {
    focusSvg: document.getElementById("focusSvg"),
    contextSvg: document.getElementById("contextSvg"),
    rankSvg: document.getElementById("rankSvg"),
    tooltip: document.getElementById("tooltip"),
    legend: document.getElementById("legend"),
    countryList: document.getElementById("countryList"),
    selectedCount: document.getElementById("selectedCount"),
    rangeLabel: document.getElementById("rangeLabel"),
    statBest: document.getElementById("statBest"),
    statWorst: document.getElementById("statWorst"),
    countrySearch: document.getElementById("countrySearch"),
    btnSelectAll: document.getElementById("btnSelectAll"),
    btnClearAll: document.getElementById("btnClearAll"),
    modeAbsolute: document.getElementById("modeAbsolute"),
    modeIndexed: document.getElementById("modeIndexed"),
    modeYoy: document.getElementById("modeYoy"),
    modeCumulative: document.getElementById("modeCumulative"),
    chkPolicyEvents: document.getElementById("chkPolicyEvents"),
    chkPoints: document.getElementById("chkPoints"),
    attentionPanel: document.getElementById("attentionPanel"),
    anchorCountry: document.getElementById("anchorCountry"),
    btnFindSimilar: document.getElementById("btnFindSimilar"),
    similarResults: document.getElementById("similarResults"),
  };

  const state = {
    dataRaw: [],
    byCountry: new Map(), // country -> [{year, value|null}]
    definedByCountry: new Map(), // country -> [{year, value}]
    years: [],
    yearExtent: [1990, 2019],
    selected: new Set(),
    hidden: new Set(), // selected but temporarily hidden via legend
    mode: "absolute", // "absolute" | "indexed" | "yoy" | "cumulative"
    showPolicyEvents: true,
    showPoints: false,
    brushDomain: null, // [y0, y1] in years; null means full
    hoverYear: null,
    hoverCountry: null,
    /** 关注点解释面板当前聚焦：{ country, year }，与 attentionKeyed 键一致 */
    attentionFocus: null,
    yearRanks: new Map(),
    attentionKeyed: new Map(),
    attentionList: [],
  };

  function fmtValue(v) {
    if (v == null || Number.isNaN(v)) return "—";
    if (Math.abs(v) >= 1000) return d3.format(",.0f")(v);
    if (Math.abs(v) >= 100) return d3.format(",.1f")(v);
    return d3.format(",.2f")(v);
  }

  function fmtDelta(v) {
    if (v == null || Number.isNaN(v)) return "—";
    const sign = v > 0 ? "+" : "";
    return `${sign}${d3.format(",.2f")(v)}`;
  }

  function fmtPct(v) {
    if (v == null || Number.isNaN(v)) return "—";
    const sign = v > 0 ? "+" : "";
    return `${sign}${d3.format(".1f")(v)}%`;
  }

  function stableColor(country) {
    // simple deterministic hash -> hue
    let h = 0;
    for (let i = 0; i < country.length; i += 1) h = (h * 31 + country.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    return `hsl(${hue} 70% 62%)`;
  }

  function getActiveDomain() {
    return state.brushDomain ?? state.yearExtent;
  }

  function clampDomain(domain) {
    const [minY, maxY] = state.yearExtent;
    const a = Math.max(minY, Math.min(maxY, domain[0]));
    const b = Math.max(minY, Math.min(maxY, domain[1]));
    return a <= b ? [a, b] : [b, a];
  }

  function getSeriesValue(country, year) {
    const defined = state.definedByCountry.get(country) ?? [];
    const i = d3.bisector((d) => d.year).center(defined, year);
    const p = defined[i];
    if (!p) return null;
    // 如果国家只有稀疏年份（如印度），允许“最近邻”但限制跨度，避免误导
    if (Math.abs(p.year - year) > 2) return null;
    return p;
  }

  function transformValue(country, year, value) {
    if (value == null || Number.isNaN(value)) return null;
    if (state.mode === "absolute") return value;

    if (state.mode === "indexed") {
      const [y0, y1] = getActiveDomain();
      const defined = state.definedByCountry.get(country) ?? [];
      const base = defined.find((d) => d.year >= y0 && d.year <= y1)?.value ?? defined[0]?.value ?? null;
      if (base == null || base === 0) return null;
      return (value / base) * 100;
    }

    if (state.mode === "yoy") {
      const defined = state.definedByCountry.get(country) ?? [];
      const i = defined.findIndex((d) => d.year === year);
      if (i <= 0) return null;
      const prev = defined[i - 1];
      if (prev.year !== year - 1) return null;
      return value - prev.value;
    }

    if (state.mode === "cumulative") {
      const [y0, y1] = getActiveDomain();
      const defined = state.definedByCountry.get(country) ?? [];
      const firstIn = defined.find((d) => d.year >= y0 && d.year <= y1);
      if (!firstIn) return null;
      if (year < y0 || year > y1 || year < firstIn.year) return null;
      return value - firstIn.value;
    }

    return null;
  }

  function pearsonCorrelation(xs, ys) {
    const n = xs.length;
    if (n < 2 || ys.length !== n) return NaN;
    const mx = d3.mean(xs);
    const my = d3.mean(ys);
    let num = 0;
    let denx = 0;
    let deny = 0;
    for (let i = 0; i < n; i += 1) {
      const dx = xs[i] - mx;
      const dy = ys[i] - my;
      num += dx * dy;
      denx += dx * dx;
      deny += dy * dy;
    }
    const den = Math.sqrt(denx) * Math.sqrt(deny);
    if (den === 0) return NaN;
    return num / den;
  }

  /** 在 xDomain 内与锚点国家排放曲线最相似的国家（皮尔森 r，越高越相似） */
  function computeSimilarity(anchor, xDomain, allCountries) {
    const aDef = state.definedByCountry.get(anchor) ?? [];
    const aIn = aDef.filter((d) => d.year >= xDomain[0] && d.year <= xDomain[1]);
    if (aIn.length < 4) return [];

    const yearToA = new Map(aIn.map((d) => [d.year, d.value]));
    const yearsA = aIn.map((d) => d.year);

    const out = [];
    for (const country of allCountries) {
      if (country === anchor) continue;
      const bDef = state.definedByCountry.get(country) ?? [];
      const bMap = new Map(bDef.map((d) => [d.year, d.value]));
      const pairs = [];
      for (const y of yearsA) {
        const av = yearToA.get(y);
        const bv = bMap.get(y);
        if (av != null && bv != null && !Number.isNaN(av) && !Number.isNaN(bv)) pairs.push({ av, bv });
      }
      if (pairs.length < 4) continue;
      const xs = pairs.map((p) => p.av);
      const ys = pairs.map((p) => p.bv);
      const r = pearsonCorrelation(xs, ys);
      if (Number.isNaN(r)) continue;
      out.push({ country, r, n: pairs.length });
    }
    out.sort((a, b) => b.r - a.r);
    return out.slice(0, 8);
  }

  function renderSimilarResults(list) {
    if (!el.similarResults) return;
    el.similarResults.innerHTML = "";
    if (!list.length) {
      el.similarResults.innerHTML =
        "<div class=\"hint\">重叠年份不足（至少 4 年且两国均有数据），请换一个锚点或扩大刷选区间。</div>";
      return;
    }
    const frag = document.createDocumentFragment();
    for (const item of list) {
      const row = document.createElement("div");
      row.className = "similar-row";

      const meta = document.createElement("div");
      meta.className = "similar-meta";
      const name = document.createElement("div");
      name.className = "similar-name";
      name.textContent = item.country;
      const rm = document.createElement("div");
      rm.className = "similar-r";
      rm.textContent = `r = ${item.r.toFixed(3)} · n = ${item.n} 年`;
      meta.appendChild(name);
      meta.appendChild(rm);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-small";
      const already = state.selected.has(item.country);
      btn.textContent = already ? "已选" : "加入对比";
      btn.disabled = already;
      btn.addEventListener("click", () => {
        state.selected.add(item.country);
        state.hidden.delete(item.country);
        updateSelectedCount();
        el.countrySearch.dispatchEvent(new Event("input"));
        renderAll();
        btn.textContent = "已选";
        btn.disabled = true;
      });

      row.appendChild(meta);
      row.appendChild(btn);
      frag.appendChild(row);
    }
    el.similarResults.appendChild(frag);
  }

  function setMode(mode) {
    const allowed = ["absolute", "indexed", "yoy", "cumulative"];
    if (!allowed.includes(mode)) return;
    state.mode = mode;
    const map = {
      absolute: el.modeAbsolute,
      indexed: el.modeIndexed,
      yoy: el.modeYoy,
      cumulative: el.modeCumulative,
    };
    for (const [k, btn] of Object.entries(map)) {
      if (!btn) continue;
      btn.classList.toggle("is-active", k === mode);
      btn.setAttribute("aria-selected", String(k === mode));
    }
    renderAll();
  }

  function modeTooltipTitle(year) {
    if (state.mode === "absolute") return `${year} 年（原始值）`;
    if (state.mode === "indexed") return `${year} 年（指数化）`;
    if (state.mode === "yoy") return `${year} 年（较上年变化）`;
    if (state.mode === "cumulative") return `${year} 年（相对区间起点偏离）`;
    return `${year} 年`;
  }

  function modeTooltipHint() {
    if (state.mode === "indexed") return "<span style='color:rgba(255,255,255,.6)'>（区间内首有效值=100）</span>";
    if (state.mode === "yoy") return "<span style='color:rgba(255,255,255,.6)'>（相邻有数据年份差分）</span>";
    if (state.mode === "cumulative")
      return "<span style='color:rgba(255,255,255,.6)'>（刷选区间内该国首年作 0 基准）</span>";
    return "";
  }

  function computeDomainY(countries, xDomain) {
    const vals = [];
    countries.forEach((c) => {
      if (state.hidden.has(c)) return;
      const defined = state.definedByCountry.get(c) ?? [];
      for (const d of defined) {
        if (d.year < xDomain[0] || d.year > xDomain[1]) continue;
        const tv = transformValue(c, d.year, d.value);
        if (tv == null) continue;
        vals.push(tv);
      }
    });
    if (!vals.length) return [0, 1];
    const extent = d3.extent(vals);
    const pad = (extent[1] - extent[0]) * 0.08 || 1;
    return [extent[0] - pad, extent[1] + pad];
  }

  function computeChanges(xDomain) {
    const out = [];
    for (const [country, defined] of state.definedByCountry.entries()) {
      const inRange = defined.filter((d) => d.year >= xDomain[0] && d.year <= xDomain[1]);
      if (inRange.length < 2) continue;
      const first = inRange[0];
      const last = inRange[inRange.length - 1];
      const delta = last.value - first.value;
      const pct = first.value === 0 ? null : (delta / first.value) * 100;
      out.push({
        country,
        firstYear: first.year,
        lastYear: last.year,
        firstValue: first.value,
        lastValue: last.value,
        delta,
        pct,
      });
    }
    return out;
  }

  /** 每年按排放量降序排名，1 = 当年最高 */
  function computeYearRanks() {
    const byYear = d3.group(state.dataRaw, (d) => d.year);
    const rankAtYear = new Map();
    for (const [year, rows] of byYear) {
      const sorted = rows.slice().sort((a, b) => b.value - a.value);
      const m = new Map();
      sorted.forEach((row, i) => m.set(row.country, i + 1));
      rankAtYear.set(year, m);
    }
    return rankAtYear;
  }

  /** 异常波动 / 显著变化关注点（基于原始排放相邻年差分） */
  function computeAttentionIndex(allCountries) {
    const keyed = new Map();
    const list = [];

    for (const country of allCountries) {
      const def = state.definedByCountry.get(country) ?? [];
      const deltas = [];
      for (let i = 1; i < def.length; i += 1) {
        if (def[i].year !== def[i - 1].year + 1) continue;
        deltas.push({
          year: def[i].year,
          delta: def[i].value - def[i - 1].value,
          prevYear: def[i - 1].year,
          prevValue: def[i - 1].value,
          currValue: def[i].value,
        });
      }
      if (deltas.length < 2) continue;

      const vals = deltas.map((d) => d.delta);
      const mean = d3.mean(vals);
      const sigma = d3.deviation(vals);
      const byYearType = new Map();

      if (sigma == null || sigma === 0 || Number.isNaN(sigma)) {
        const sorted = [...deltas].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
        for (const d of sorted.slice(0, 2)) byYearType.set(d.year, "significant");
      } else {
        const marked = new Set();
        for (const d of deltas) {
          if (d.delta > mean + 2 * sigma || d.delta < mean - 2 * sigma) {
            marked.add(d.year);
            byYearType.set(d.year, "anomaly");
          }
        }
        const rest = deltas.filter((d) => !marked.has(d.year));
        rest.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
        for (const d of rest.slice(0, 2)) {
          if (!byYearType.has(d.year)) byYearType.set(d.year, "significant");
        }
      }

      for (const [year, kind] of byYearType) {
        const d = deltas.find((x) => x.year === year);
        if (!d) continue;
        const obj = {
          country,
          year,
          kind,
          delta: d.delta,
          prevYear: d.prevYear,
          prevValue: d.prevValue,
          currValue: d.currValue,
          mean,
          sigma: sigma == null || Number.isNaN(sigma) ? 0 : sigma,
        };
        keyed.set(`${country}|${year}`, obj);
        list.push(obj);
      }
    }
    return { keyed, list };
  }

  function pickDefaultSelection(countries) {
    const preferred = ["United States", "China", "India", "Germany", "Brazil", "Russia", "Japan", "United Kingdom"];
    const chosen = [];
    for (const p of preferred) if (countries.includes(p)) chosen.push(p);
    for (const c of countries) {
      if (chosen.length >= 8) break;
      if (!chosen.includes(c)) chosen.push(c);
    }
    return chosen.slice(0, 8);
  }

  function setupUI(allCountries) {
    // country list
    function renderCountryList(filter = "") {
      const q = filter.trim().toLowerCase();
      const countries = q ? allCountries.filter((c) => c.toLowerCase().includes(q)) : allCountries;

      el.countryList.innerHTML = "";
      const frag = document.createDocumentFragment();

      for (const c of countries) {
        const item = document.createElement("div");
        item.className = `country-item${state.selected.has(c) ? " is-selected" : ""}`;
        item.dataset.country = c;

        const left = document.createElement("div");
        left.className = "country-left";

        const sw = document.createElement("div");
        sw.className = "swatch";
        sw.style.background = stableColor(c);

        const name = document.createElement("div");
        name.className = "country-name";
        name.textContent = c;

        left.appendChild(sw);
        left.appendChild(name);

        const pill = document.createElement("div");
        pill.className = "pill";
        const defined = state.definedByCountry.get(c) ?? [];
        pill.textContent = `${defined[0]?.year ?? "?"}–${defined.at(-1)?.year ?? "?"}`;

        item.appendChild(left);
        item.appendChild(pill);

        item.addEventListener("click", () => {
          if (state.selected.has(c)) state.selected.delete(c);
          else state.selected.add(c);
          state.hidden.delete(c);
          updateSelectedCount();
          renderCountryList(el.countrySearch.value);
          renderAll();
        });

        frag.appendChild(item);
      }

      el.countryList.appendChild(frag);
    }

    el.countrySearch.addEventListener("input", (e) => renderCountryList(e.target.value));

    el.btnSelectAll.addEventListener("click", () => {
      allCountries.forEach((c) => state.selected.add(c));
      state.hidden.clear();
      updateSelectedCount();
      renderCountryList(el.countrySearch.value);
      renderAll();
    });

    el.btnClearAll.addEventListener("click", () => {
      state.selected.clear();
      state.hidden.clear();
      updateSelectedCount();
      renderCountryList(el.countrySearch.value);
      renderAll();
    });

    el.modeAbsolute.addEventListener("click", () => setMode("absolute"));
    el.modeIndexed.addEventListener("click", () => setMode("indexed"));
    if (el.modeYoy) el.modeYoy.addEventListener("click", () => setMode("yoy"));
    if (el.modeCumulative) el.modeCumulative.addEventListener("click", () => setMode("cumulative"));

    if (el.anchorCountry) {
      el.anchorCountry.innerHTML = "";
      for (const c of allCountries) {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        el.anchorCountry.appendChild(opt);
      }
      el.anchorCountry.value = allCountries.includes("United States")
        ? "United States"
        : (allCountries[0] ?? "");
    }
    if (el.btnFindSimilar && el.anchorCountry) {
      el.btnFindSimilar.addEventListener("click", () => {
        const anchor = el.anchorCountry.value;
        const domain = getActiveDomain();
        const list = computeSimilarity(anchor, domain, allCountries);
        renderSimilarResults(list);
      });
    }

    if (el.chkPolicyEvents) {
      el.chkPolicyEvents.addEventListener("change", (e) => {
        state.showPolicyEvents = e.target.checked;
        renderAll();
      });
    }
    el.chkPoints.addEventListener("change", (e) => {
      state.showPoints = e.target.checked;
      renderAll();
    });

    renderCountryList("");
    updateSelectedCount();
  }

  function updateSelectedCount() {
    el.selectedCount.textContent = String(state.selected.size);
  }

  function setRangeLabel(domain) {
    const full = state.yearExtent;
    if (!domain || (domain[0] === full[0] && domain[1] === full[1])) {
      el.rangeLabel.textContent = "全时段";
      return;
    }
    el.rangeLabel.textContent = `${domain[0]}–${domain[1]}`;
  }

  function renderLegend(countries) {
    el.legend.innerHTML = "";
    const frag = document.createDocumentFragment();

    for (const c of countries) {
      const item = document.createElement("div");
      item.className = `legend-item${state.hidden.has(c) ? " is-muted" : ""}`;
      item.dataset.country = c;

      const sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.width = "9px";
      sw.style.height = "9px";
      sw.style.boxShadow = "0 0 0 2px rgba(255,255,255,.05)";
      sw.style.background = stableColor(c);

      const text = document.createElement("span");
      text.textContent = c;

      item.appendChild(sw);
      item.appendChild(text);

      item.addEventListener("click", () => {
        if (!state.selected.has(c)) state.selected.add(c);
        if (state.hidden.has(c)) state.hidden.delete(c);
        else state.hidden.add(c);
        updateSelectedCount();
        renderLegend(Array.from(state.selected));
        renderFocusChart();
        renderRankChart();
      });

      frag.appendChild(item);
    }
    el.legend.appendChild(frag);
  }

  // ---------- Charts ----------
  let focus = null;
  let context = null;
  let rank = null;

  function focusPolicyEvent(ev) {
    const [minY, maxY] = state.yearExtent;
    const cy = ev.year;
    const pad = ev.padYears ?? 4;
    const y0 = Math.max(minY, cy - pad);
    const y1 = Math.min(maxY, cy + pad);
    state.brushDomain = clampDomain([y0, y1]);
    setRangeLabel(state.brushDomain);
    if (context) context.setBrushFromDomain(state.brushDomain);
    renderAll(false);
  }

  function renderAttentionPanel() {
    const panel = el.attentionPanel;
    if (!panel) return;
    const f = state.attentionFocus;
    if (!f) {
      panel.innerHTML =
        "<p class=\"attention-placeholder\">在主图中悬停或点击<strong>空心圆关注点</strong>（红：异常波动；蓝：显著变化），此处将显示解释。</p>";
      return;
    }
    const pt = state.attentionKeyed.get(`${f.country}|${f.year}`);
    if (!pt) {
      panel.innerHTML = "<p class=\"attention-placeholder\">未找到该点的统计数据。</p>";
      return;
    }
    const ry = state.yearRanks.get(pt.year);
    const rpy = state.yearRanks.get(pt.prevYear);
    const rankCurr = ry?.get(pt.country) ?? null;
    const rankPrev = rpy?.get(pt.country) ?? null;
    const rankDelta = rankCurr != null && rankPrev != null ? rankPrev - rankCurr : null;
    const typeLabel = pt.kind === "anomaly" ? "异常波动" : "显著变化";
    const why =
      pt.kind === "anomaly"
        ? "该年较上年排放变化量超出该国自身全部年度变化的常规范围（超出均值 ± 2 倍标准差），属于统计意义上的异常波动。"
        : "在所分析时段内，该国年度变化绝对值名列前茅，便于定位排放轨迹的“急转”年份。";
    const sigmaStr =
      pt.sigma == null || pt.sigma === 0 || Number.isNaN(pt.sigma) ? "—" : d3.format(".4f")(pt.sigma);
    const low = pt.sigma ? pt.mean - 2 * pt.sigma : null;
    const high = pt.sigma ? pt.mean + 2 * pt.sigma : null;
    const band =
      low == null || high == null
        ? "（该国年度变化标准差为 0，仅用 Top|Δ| 规则标注显著变化）"
        : `约 ${fmtDelta(low)} ~ ${fmtDelta(high)}`;

    panel.innerHTML = `
      <div class="attention-head">
        <span class="attention-badge attention-badge--${pt.kind}">${typeLabel}</span>
        <span class="attention-title">${pt.country} · ${pt.year}</span>
      </div>
      <p class="attention-why">${why}</p>
      <dl class="attention-dl">
        <dt>较上年变化</dt><dd>${fmtDelta(pt.delta)}</dd>
        <dt>上一年全球排名</dt><dd>${rankPrev != null ? String(rankPrev) : "—"}</dd>
        <dt>当年全球排名</dt><dd>${rankCurr != null ? String(rankCurr) : "—"}</dd>
        <dt>排名变化</dt><dd>${
          rankDelta == null
            ? "—"
            : `${rankDelta > 0 ? "+" : ""}${rankDelta}（正：名次数字变小，相对更高排放位次靠近）`
        }</dd>
        <dt>本国年度变化均值 ± 2σ</dt><dd>${fmtDelta(pt.mean)} ± 2×${sigmaStr} → 阈值带 ${band}</dd>
      </dl>
    `;
  }

  function findNearestAttentionPoint(mx, my, xScale, yScale, selected, xDomain) {
    const candidates = state.attentionList.filter(
      (p) => selected.includes(p.country) && p.year >= xDomain[0] && p.year <= xDomain[1],
    );
    let best = null;
    let bestD2 = Infinity;
    const thr = 20;
    for (const p of candidates) {
      const tv = transformValue(p.country, p.year, p.currValue);
      if (tv == null) continue;
      const px = xScale(p.year);
      const py = yScale(tv);
      const dx = mx - px;
      const dy = my - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2 && d2 <= thr * thr) {
        bestD2 = d2;
        best = p;
      }
    }
    return best;
  }

  function initCharts() {
    focus = makeFocusChart(el.focusSvg);
    context = makeContextChart(el.contextSvg);
    rank = makeRankChart(el.rankSvg);

    // 关键：首次创建后立刻 resize 一次，保证 zoom/brush 的 extent 已初始化
    focus.resize();
    context.resize();
    rank.resize();

    window.addEventListener("resize", () => {
      focus.resize();
      context.resize();
      rank.resize();
      renderAll();
    });
  }

  function makeFocusChart(svgEl) {
    const svg = d3.select(svgEl);
    const g = svg.append("g");
    const defs = svg.append("defs");

    const margin = { top: 18, right: 18, bottom: 36, left: 54 };
    let width = 800;
    let height = 420;

    const clipId = `clip-${Math.random().toString(16).slice(2)}`;
    defs
      .append("clipPath")
      .attr("id", clipId)
      .append("rect")
      .attr("x", 0)
      .attr("y", 0);

    const gridG = g.append("g").attr("class", "gridline");
    const xAxisG = g.append("g").attr("class", "axis axis-x");
    const yAxisG = g.append("g").attr("class", "axis axis-y");

    const policyEventsBackG = g.append("g").attr("class", "policy-events-back").attr("clip-path", `url(#${clipId})`);
    const linesG = g.append("g").attr("clip-path", `url(#${clipId})`);
    const pointsG = g.append("g").attr("clip-path", `url(#${clipId})`);
    const attentionG = g.append("g").attr("class", "attention-layer").attr("clip-path", `url(#${clipId})`);
    const hoverG = g.append("g").attr("clip-path", `url(#${clipId})`);

    const crosshair = hoverG.append("line").attr("class", "crosshair").style("opacity", 0);

    const overlay = g.append("rect").attr("fill", "transparent").style("cursor", "crosshair");
    const policyEventsUiG = g
      .append("g")
      .attr("class", "policy-events-ui")
      .attr("clip-path", `url(#${clipId})`);

    let lastAttentionHoverKey = null;

    const xFull = d3.scaleLinear();
    const x = d3.scaleLinear();
    const y = d3.scaleLinear();
    let isSyncingZoom = false;

    const line = d3
      .line()
      .defined((d) => d.tvalue != null)
      .x((d) => x(d.year))
      .y((d) => y(d.tvalue));

    const zoom = d3
      .zoom()
      .scaleExtent([1, 14])
      .translateExtent([
        [0, 0],
        [width, height],
      ])
      .extent([
        [0, 0],
        [width, height],
      ])
      .on("zoom", (event) => {
        if (isSyncingZoom) return;
        if (!context) return;
        const zx = event.transform.rescaleX(xFull);
        const dom = clampDomain(zx.domain().map((d) => Math.round(d)));
        state.brushDomain = dom;
        setRangeLabel(dom);
        context.setBrushFromDomain(dom);
        renderAll(false); // avoid feedback loop
      });

    function resize() {
      const rect = svgEl.getBoundingClientRect();
      width = Math.max(520, rect.width);
      height = rect.height || 430;
      svg.attr("viewBox", `0 0 ${width} ${height}`);

      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;

      g.attr("transform", `translate(${margin.left},${margin.top})`);

      defs.select(`#${clipId} rect`).attr("width", innerW).attr("height", innerH);
      overlay.attr("x", 0).attr("y", 0).attr("width", innerW).attr("height", innerH);

      xFull.range([0, innerW]);
      x.range([0, innerW]);
      y.range([innerH, 0]);

      xAxisG.attr("transform", `translate(0,${innerH})`);
      yAxisG.attr("transform", `translate(0,0)`);

      crosshair.attr("y1", 0).attr("y2", innerH);

      zoom.translateExtent([
        [0, 0],
        [innerW, innerH],
      ]);
      zoom.extent([
        [0, 0],
        [innerW, innerH],
      ]);

      overlay.call(zoom);
    }

    function render() {
      const selected = Array.from(state.selected);
      renderLegend(selected);

      const xDomain = getActiveDomain();
      setRangeLabel(xDomain);

      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;

      xFull.domain(state.yearExtent);
      x.domain(xDomain);

      const yDomain = computeDomainY(selected, xDomain);
      y.domain(yDomain);

      // grid
      gridG.selectAll("*").remove();
      gridG
        .append("g")
        .call(d3.axisLeft(y).ticks(6).tickSize(-innerW).tickFormat(""))
        .call((gg) => gg.selectAll(".tick line").attr("opacity", 1))
        .call((gg) => gg.select(".domain").remove());

      xAxisG.call(d3.axisBottom(x).ticks(Math.min(10, innerW / 70)).tickFormat(d3.format("d")));
      yAxisG.call(d3.axisLeft(y).ticks(6));

      // 政策事件：折线背后竖线 + 顶层可点击热区与标签
      policyEventsBackG.selectAll("*").remove();
      policyEventsUiG.selectAll("*").remove();
      if (state.showPolicyEvents) {
        const visible = POLICY_EVENTS.filter((ev) => ev.year >= xDomain[0] && ev.year <= xDomain[1]).sort(
          (a, b) => a.year - b.year,
        );
        visible.forEach((ev, i) => {
          const xv = x(ev.year);
          policyEventsBackG
            .append("line")
            .attr("class", "policy-event-line")
            .attr("x1", xv)
            .attr("x2", xv)
            .attr("y1", 0)
            .attr("y2", innerH);

          policyEventsUiG
            .append("rect")
            .attr("class", "policy-event-hit")
            .attr("x", xv - 7)
            .attr("y", 0)
            .attr("width", 14)
            .attr("height", innerH)
            .attr("tabindex", 0)
            .attr("role", "button")
            .attr("aria-label", `${ev.year} ${ev.label}，点击或 Enter 聚焦该年前后区间`)
            .on("click", (e) => {
              e.stopPropagation();
              focusPolicyEvent(ev);
            })
            .on("keydown", (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                focusPolicyEvent(ev);
              }
            });

          const ty = 14 + (i % 5) * 15;
          policyEventsUiG
            .append("text")
            .attr("class", "policy-event-label")
            .attr("x", xv + 8)
            .attr("y", ty)
            .text(`${ev.year} ${ev.label}`);
        });
      }

      // prepare series for drawing
      const series = selected.map((country) => {
        const arr = state.byCountry.get(country) ?? [];
        const points = arr.map((d) => ({
          country,
          year: d.year,
          value: d.value,
          tvalue: d.value == null ? null : transformValue(country, d.year, d.value),
        }));
        return { country, points };
      });

      // lines
      const paths = linesG.selectAll("path.focus-line").data(series, (d) => d.country);
      paths
        .join(
          (enter) =>
            enter
              .append("path")
              .attr("class", "focus-line")
              .attr("stroke", (d) => stableColor(d.country))
              .attr("d", (d) => line(d.points)),
          (update) => update.attr("stroke", (d) => stableColor(d.country)).attr("d", (d) => line(d.points)),
          (exit) => exit.remove(),
        )
        .classed("is-hidden", (d) => state.hidden.has(d.country));

      // 关注点（空心圆）：仅已选且未隐藏国家
      const attData = state.attentionList
        .filter(
          (p) =>
            selected.includes(p.country) &&
            !state.hidden.has(p.country) &&
            p.year >= xDomain[0] &&
            p.year <= xDomain[1],
        )
        .filter((p) => transformValue(p.country, p.year, p.currValue) != null);

      attentionG
        .selectAll("circle.attention-dot")
        .data(attData, (d) => `${d.country}|${d.year}`)
        .join(
          (enter) =>
            enter
              .append("circle")
              .attr("class", (d) => `attention-dot attention-dot--${d.kind}`)
              .attr("r", 6),
          (update) =>
            update
              .attr("class", (d) => `attention-dot attention-dot--${d.kind}`)
              .attr("cx", (d) => x(d.year))
              .attr("cy", (d) => y(transformValue(d.country, d.year, d.currValue))),
          (exit) => exit.remove(),
        )
        .attr("cx", (d) => x(d.year))
        .attr("cy", (d) => y(transformValue(d.country, d.year, d.currValue)))
        .style("pointer-events", "none");

      // points
      pointsG.selectAll("*").remove();
      if (state.showPoints) {
        const flat = series.flatMap((s) =>
          s.points
            .filter((p) => p.value != null && p.tvalue != null && p.year >= xDomain[0] && p.year <= xDomain[1])
            .map((p) => ({ ...p, color: stableColor(s.country) })),
        );
        pointsG
          .selectAll("circle.point")
          .data(flat)
          .join("circle")
          .attr("class", "point")
          .attr("r", 2.4)
          .attr("cx", (d) => x(d.year))
          .attr("cy", (d) => y(d.tvalue))
          .attr("fill", (d) => d.color)
          .style("opacity", (d) => (state.hidden.has(d.country) ? 0 : 0.9));
      }

      // hover interaction
      overlay.on("mousemove", (event) => {
        const [mx, my] = d3.pointer(event, overlay.node());
        const year = Math.round(x.invert(mx));
        const clamped = Math.max(xDomain[0], Math.min(xDomain[1], year));
        state.hoverYear = clamped;

        const activeCountries = selected.filter((c) => !state.hidden.has(c));
        const nearestAtt = findNearestAttentionPoint(mx, my, x, y, activeCountries, xDomain);
        if (nearestAtt) {
          const k = `${nearestAtt.country}|${nearestAtt.year}`;
          if (k !== lastAttentionHoverKey) {
            lastAttentionHoverKey = k;
            state.attentionFocus = { country: nearestAtt.country, year: nearestAtt.year };
            renderAttentionPanel();
          }
        }

        const rows = [];
        for (const c of activeCountries) {
          const p = getSeriesValue(c, clamped);
          if (!p) continue;
          const tval = transformValue(c, p.year, p.value);
          if (tval == null) continue;
          rows.push({ country: c, year: p.year, value: p.value, tvalue: tval });
        }
        rows.sort((a, b) => b.tvalue - a.tvalue);

        // crosshair
        crosshair.attr("x1", x(clamped)).attr("x2", x(clamped)).style("opacity", rows.length ? 1 : 0);

        // highlight dots
        hoverG.selectAll("circle").remove();
        hoverG
          .selectAll("circle")
          .data(rows)
          .join("circle")
          .attr("r", 4.0)
          .attr("cx", (d) => x(d.year))
          .attr("cy", (d) => y(d.tvalue))
          .attr("fill", (d) => stableColor(d.country))
          .attr("stroke", "rgba(0,0,0,.35)")
          .attr("stroke-width", 1.2);

        renderTooltip(event, clamped, rows);
        rank.highlightCountries(new Set(rows.map((r) => r.country)));
      });

      overlay.on("click", (event) => {
        const [mx, my] = d3.pointer(event, overlay.node());
        const activeCountries = selected.filter((c) => !state.hidden.has(c));
        const nearestAtt = findNearestAttentionPoint(mx, my, x, y, activeCountries, xDomain);
        if (nearestAtt) {
          event.stopPropagation();
          state.attentionFocus = { country: nearestAtt.country, year: nearestAtt.year };
          renderAttentionPanel();
        }
      });

      overlay.on("mouseleave", () => {
        state.hoverYear = null;
        lastAttentionHoverKey = null;
        state.attentionFocus = null;
        renderAttentionPanel();
        crosshair.style("opacity", 0);
        hoverG.selectAll("circle").remove();
        hideTooltip();
        rank.highlightCountries(new Set());
      });

      // sync zoom transform with brush domain (when brush changes)
      const dom = xDomain;
      const a = xFull(dom[0]);
      const b = xFull(dom[1]);
      const k = innerW / Math.max(1, b - a);
      const t = d3.zoomIdentity.translate(-a * k, 0).scale(k);
      isSyncingZoom = true;
      overlay.call(zoom.transform, t);
      // 释放同步锁，避免 zoom ↔ brush 的事件回环
      setTimeout(() => {
        isSyncingZoom = false;
      }, 0);
    }

    function renderTooltip(event, year, rows) {
      if (!rows.length) {
        hideTooltip();
        return;
      }
      const title = modeTooltipTitle(year);
      const top = rows.slice(0, 9);

      const unitHint = modeTooltipHint();
      el.tooltip.innerHTML = `
        <div class="tt-title">${title} ${unitHint}</div>
        ${top
          .map((r) => {
            let v;
            if (state.mode === "absolute") v = fmtValue(r.value);
            else if (state.mode === "indexed") v = fmtValue(r.tvalue);
            else v = fmtDelta(r.tvalue);
            return `
              <div class="tt-row" data-country="${r.country}">
                <div class="tt-left">
                  <span class="tt-dot" style="background:${stableColor(r.country)}"></span>
                  <span class="tt-name">${r.country}</span>
                </div>
                <div class="tt-val">${v}</div>
              </div>
            `;
          })
          .join("")}
        ${
          rows.length > top.length
            ? `<div class="tt-row"><div style="color:rgba(255,255,255,.6)">…另外 ${rows.length - top.length} 个国家</div><div></div></div>`
            : ""
        }
      `;

      const wrap = el.focusSvg.getBoundingClientRect();
      const [mx, my] = d3.pointer(event, document.body);
      const left = Math.min(mx + 14, wrap.left + wrap.width - 380);
      const topPx = Math.max(wrap.top + 10, my - 10);

      el.tooltip.style.left = `${left}px`;
      el.tooltip.style.top = `${topPx}px`;
      el.tooltip.classList.add("is-show");
      el.tooltip.setAttribute("aria-hidden", "false");
    }

    function hideTooltip() {
      el.tooltip.classList.remove("is-show");
      el.tooltip.setAttribute("aria-hidden", "true");
    }

    return { resize, render };
  }

  function makeContextChart(svgEl) {
    const svg = d3.select(svgEl);
    const g = svg.append("g");
    const margin = { top: 14, right: 18, bottom: 30, left: 54 };
    let width = 800;
    let height = 120;

    const x = d3.scaleLinear();
    const y = d3.scaleLinear();
    const xAxisG = g.append("g").attr("class", "axis axis-x");
    const yAxisG = g.append("g").attr("class", "axis axis-y");
    const pathG = g.append("g");
    const eventTicksG = g.append("g").attr("class", "context-event-layer");
    const brushG = g.append("g").attr("class", "brush");
    let isSyncingBrush = false;

    const line = d3
      .line()
      .defined((d) => d.value != null)
      .x((d) => x(d.year))
      .y((d) => y(d.value));

    const brush = d3
      .brushX()
      .on("brush end", (event) => {
        if (isSyncingBrush) return;
        if (!event.selection) {
          state.brushDomain = null;
          setRangeLabel(null);
          renderAll(false);
          return;
        }
        const [sx0, sx1] = event.selection;
        const dom = clampDomain([Math.round(x.invert(sx0)), Math.round(x.invert(sx1))]);
        state.brushDomain = dom;
        setRangeLabel(dom);
        renderAll(false);
      });

    function resize() {
      const rect = svgEl.getBoundingClientRect();
      width = Math.max(520, rect.width);
      height = rect.height || 120;
      svg.attr("viewBox", `0 0 ${width} ${height}`);

      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;
      g.attr("transform", `translate(${margin.left},${margin.top})`);

      x.range([0, innerW]).domain(state.yearExtent);
      y.range([innerH, 0]);

      xAxisG.attr("transform", `translate(0,${innerH})`);
      yAxisG.attr("transform", `translate(0,0)`);

      brush.extent([
        [0, 0],
        [innerW, innerH],
      ]);
      brushG.call(brush);
    }

    function render() {
      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;

      // global context series: yearly mean (ignores missing)
      const yearMap = new Map();
      for (const d of state.dataRaw) {
        if (!yearMap.has(d.year)) yearMap.set(d.year, []);
        yearMap.get(d.year).push(d.value);
      }
      const series = state.years.map((yy) => {
        const arr = yearMap.get(yy) ?? [];
        if (!arr.length) return { year: yy, value: null };
        return { year: yy, value: d3.mean(arr) };
      });

      const extent = d3.extent(series.map((d) => d.value).filter((v) => v != null));
      const pad = (extent[1] - extent[0]) * 0.12 || 1;
      y.domain([extent[0] - pad, extent[1] + pad]);

      pathG.selectAll("*").remove();
      pathG
        .append("path")
        .attr("d", line(series))
        .attr("fill", "none")
        .attr("stroke", "rgba(255,255,255,.55)")
        .attr("stroke-width", 1.6);

      // axes
      xAxisG.call(d3.axisBottom(x).ticks(Math.min(10, innerW / 70)).tickFormat(d3.format("d")));
      yAxisG.call(d3.axisLeft(y).ticks(3));

      eventTicksG.selectAll("*").remove();
      if (state.showPolicyEvents) {
        for (const ev of POLICY_EVENTS) {
          const cx = x(ev.year);
          if (cx < -2 || cx > innerW + 2) continue;
          eventTicksG
            .append("path")
            .attr("class", "context-event-tick")
            .attr("d", `M${cx - 3.5},${innerH - 1} L${cx + 3.5},${innerH - 1} L${cx},${innerH - 9} Z`);
        }
      }

      // set brush selection based on state
      setBrushFromDomain(getActiveDomain());
    }

    function setBrushFromDomain(domain) {
      // 兜底：若 brush 尚未挂载到 brushG，先挂载一次，避免 brush.move 读取内部状态时报错
      if (!brushG.node()?.__brush) {
        brushG.call(brush);
      }
      const innerW = width - margin.left - margin.right;
      const dom = domain ?? state.yearExtent;
      const sx0 = x(dom[0]);
      const sx1 = x(dom[1]);
      // avoid invalid selections
      const a = Math.max(0, Math.min(innerW, sx0));
      const b = Math.max(0, Math.min(innerW, sx1));
      isSyncingBrush = true;
      brushG.call(brush.move, [a, b]);
      setTimeout(() => {
        isSyncingBrush = false;
      }, 0);
    }

    return { resize, render, setBrushFromDomain };
  }

  function makeRankChart(svgEl) {
    const svg = d3.select(svgEl);
    const g = svg.append("g");
    const margin = { top: 20, right: 16, bottom: 26, left: 110 };
    let width = 360;
    let height = 520;

    const x = d3.scaleLinear();
    const y = d3.scaleBand().paddingInner(0.18).paddingOuter(0.12);
    const xAxisG = g.append("g").attr("class", "axis axis-x");
    const yAxisG = g.append("g").attr("class", "axis axis-y");
    const barsG = g.append("g");
    const zeroG = g.append("g");

    let highlighted = new Set();

    function resize() {
      const rect = svgEl.getBoundingClientRect();
      width = Math.max(320, rect.width);
      height = rect.height || 520;
      svg.attr("viewBox", `0 0 ${width} ${height}`);

      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;
      g.attr("transform", `translate(${margin.left},${margin.top})`);

      x.range([0, innerW]);
      y.range([0, innerH]);

      xAxisG.attr("transform", `translate(0,${innerH})`);
    }

    function render() {
      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;
      const xDomain = getActiveDomain();

      const changes = computeChanges(xDomain);
      if (!changes.length) {
        barsG.selectAll("*").remove();
        yAxisG.selectAll("*").remove();
        xAxisG.selectAll("*").remove();
        el.statBest.textContent = "—";
        el.statWorst.textContent = "—";
        return;
      }

      const dec = changes
        .slice()
        .sort((a, b) => a.delta - b.delta)
        .slice(0, 10);
      const inc = changes
        .slice()
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 10);

      const best = dec[0];
      const worst = inc[0];
      el.statBest.textContent = `${best.country}（${fmtDelta(best.delta)} / ${fmtPct(best.pct)}）`;
      el.statWorst.textContent = `${worst.country}（${fmtDelta(worst.delta)} / ${fmtPct(worst.pct)}）`;

      const data = [
        ...dec.map((d) => ({ ...d, group: "减排" })),
        { country: "—", delta: 0, isSeparator: true },
        ...inc.map((d) => ({ ...d, group: "增排" })),
      ];

      const deltas = changes.map((d) => d.delta);
      const maxAbs = Math.max(Math.abs(d3.min(deltas)), Math.abs(d3.max(deltas))) || 1;
      x.domain([-maxAbs, maxAbs]).nice();
      y.domain(data.map((d, i) => `${i}:${d.country}`));

      // zero line
      zeroG.selectAll("*").remove();
      zeroG
        .append("line")
        .attr("x1", x(0))
        .attr("x2", x(0))
        .attr("y1", 0)
        .attr("y2", innerH)
        .attr("stroke", "rgba(255,255,255,.18)")
        .attr("stroke-width", 1);

      // axes
      xAxisG.call(
        d3
          .axisBottom(x)
          .ticks(5)
          .tickFormat((d) => (d === 0 ? "0" : d3.format("+.2f")(d))),
      );
      yAxisG.call(
        d3.axisLeft(y).tickFormat((key) => {
          const idx = Number(key.split(":")[0]);
          const d = data[idx];
          if (!d || d.isSeparator) return "";
          return d.country;
        }),
      );
      yAxisG.selectAll(".tick text").attr("fill", "rgba(255,255,255,.78)");
      yAxisG.selectAll(".tick line").attr("opacity", 0);
      yAxisG.select(".domain").attr("opacity", 0.4);
      // 给 y 轴文字更多内边距，减少与数值标签的空间竞争
      yAxisG.selectAll(".tick text").attr("dx", "-0.2em");

      // bars
      const bars = barsG.selectAll("rect").data(data, (d, i) => `${i}:${d.country}`);
      bars
        .join(
          (enter) => enter.append("rect"),
          (update) => update,
          (exit) => exit.remove(),
        )
        .attr("x", (d) => (d.isSeparator ? x(0) : x(Math.min(0, d.delta))))
        .attr("y", (d, i) => y(`${i}:${d.country}`) ?? 0)
        .attr("height", y.bandwidth())
        .attr("width", (d) => (d.isSeparator ? 0 : Math.abs(x(d.delta) - x(0))))
        .attr("rx", 6)
        .attr("fill", (d) => {
          if (d.isSeparator) return "transparent";
          return d.delta <= 0 ? "rgba(199,249,204,.70)" : "rgba(255,122,144,.72)";
        })
        .attr("stroke", (d) => {
          if (d.isSeparator) return "transparent";
          const c = stableColor(d.country);
          if (highlighted.has(d.country)) return c;
          return "rgba(255,255,255,.10)";
        })
        .attr("stroke-width", (d) => (d.isSeparator ? 0 : highlighted.has(d.country) ? 2 : 1))
        .style("cursor", (d) => (d.isSeparator ? "default" : "pointer"))
        .style("opacity", (d) => {
          if (d.isSeparator) return 0;
          // 选中与未选中都可看，但用轻微对比引导
          const selected = state.selected.has(d.country);
          return selected ? 1 : 0.88;
        })
        .on("click", (event, d) => {
          if (d.isSeparator) return;
          if (state.selected.has(d.country)) state.selected.delete(d.country);
          else state.selected.add(d.country);
          state.hidden.delete(d.country);
          updateSelectedCount();
          // 更新列表选中态（保留当前搜索过滤）
          const q = el.countrySearch.value;
          el.countrySearch.dispatchEvent(new Event("input"));
          renderAll();
        })
        .on("mousemove", (event, d) => {
          if (d.isSeparator) return;
          const hint = `${d.country}: ${fmtDelta(d.delta)}（${fmtPct(d.pct)}）`;
          svgEl.setAttribute("aria-label", `区间变化排行条形图。当前：${hint}`);
        });

      // value labels
      barsG.selectAll("text").remove();
      const labelData = data
        .map((d, i) => ({ ...d, _i: i }))
        .filter((d) => !d.isSeparator);

      const pad = 6;
      const minLabelBarWidth = 48; // 条形足够长时，把数值放进条形内部，避免与国家名重叠

      function labelY(d) {
        return (y(`${d._i}:${d.country}`) ?? 0) + y.bandwidth() / 2 + 4;
      }

      function barWidth(d) {
        return Math.abs(x(d.delta) - x(0));
      }

      function labelLayout(d) {
        const w = barWidth(d);
        const innerLeft = 0;
        const innerRight = innerW;

        // 优先：条形足够长 -> 标签放到条形内部末端
        if (w >= minLabelBarWidth) {
          if (d.delta >= 0) {
            return {
              x: Math.max(innerLeft + pad, Math.min(innerRight - pad, x(d.delta) - pad)),
              anchor: "end",
              fill: "rgba(0,0,0,.70)",
            };
          }
          return {
            x: Math.max(innerLeft + pad, Math.min(innerRight - pad, x(d.delta) + pad)),
            anchor: "start",
            fill: "rgba(0,0,0,.70)",
          };
        }

        // 否则：条形太短 -> 标签放在 0 线附近（另一侧），避免挤到 y 轴国家名
        if (d.delta >= 0) {
          return {
            x: Math.max(innerLeft + pad, Math.min(innerRight - pad, x(0) - pad)),
            anchor: "end",
            fill: "rgba(255,255,255,.82)",
          };
        }
        return {
          x: Math.max(innerLeft + pad, Math.min(innerRight - pad, x(0) + pad)),
          anchor: "start",
          fill: "rgba(255,255,255,.82)",
        };
      }

      const labels = barsG.selectAll("text.value").data(labelData, (d) => `${d._i}:${d.country}`);
      labels
        .join(
          (enter) => enter.append("text").attr("class", "value"),
          (update) => update,
          (exit) => exit.remove(),
        )
        .attr("x", (d) => labelLayout(d).x)
        .attr("y", (d) => labelY(d))
        .attr("text-anchor", (d) => labelLayout(d).anchor)
        .attr("fill", (d) => labelLayout(d).fill)
        .attr("font-size", 11)
        .attr(
          "font-family",
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        )
        .text((d) => fmtDelta(d.delta));
    }

    function highlightCountries(set) {
      highlighted = set;
      render(); // lightweight enough for current dataset size
    }

    return { resize, render, highlightCountries };
  }

  function renderFocusChart() {
    focus.render();
  }

  function renderContextChart() {
    context.render();
  }

  function renderRankChart() {
    rank.render();
  }

  function renderAll(syncContext = true) {
    // 当由 focus 的 zoom 推动更新时，会主动调用 context.setBrushFromDomain，因此这里可选择不重复
    if (syncContext) renderContextChart();
    renderFocusChart();
    renderRankChart();
    renderAttentionPanel();
  }

  async function load() {
    const raw = await d3.json(DATA_URL);
    state.dataRaw = raw
      .filter((d) => d && d.country != null && d.year != null && d.value != null)
      .map((d) => ({ country: String(d.country), year: +d.year, value: +d.value }))
      .filter((d) => !Number.isNaN(d.year) && !Number.isNaN(d.value));

    const allCountries = Array.from(d3.group(state.dataRaw, (d) => d.country).keys()).sort(d3.ascending);
    const years = Array.from(new Set(state.dataRaw.map((d) => d.year))).sort((a, b) => a - b);
    state.years = years;
    state.yearExtent = d3.extent(years);

    // build complete yearly series per country (fill missing with nulls, to avoid misleading straight connections)
    for (const country of allCountries) {
      const arr = state.dataRaw.filter((d) => d.country === country).sort((a, b) => a.year - b.year);
      const map = new Map(arr.map((d) => [d.year, d.value]));
      const full = [];
      for (let y = state.yearExtent[0]; y <= state.yearExtent[1]; y += 1) {
        full.push({ year: y, value: map.has(y) ? map.get(y) : null });
      }
      state.byCountry.set(country, full);
      state.definedByCountry.set(
        country,
        full.filter((d) => d.value != null),
      );
    }

    // default selection
    pickDefaultSelection(allCountries).forEach((c) => state.selected.add(c));

    state.yearRanks = computeYearRanks();
    const att = computeAttentionIndex(allCountries);
    state.attentionKeyed = att.keyed;
    state.attentionList = att.list;

    setupUI(allCountries);
    initCharts();
    context.setBrushFromDomain(state.yearExtent);
    renderAll();
  }

  return { load };
})();

App.load().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  const msg = document.createElement("div");
  msg.style.padding = "16px";
  msg.style.margin = "16px";
  msg.style.border = "1px solid rgba(255,255,255,.16)";
  msg.style.borderRadius = "12px";
  msg.style.background = "rgba(0,0,0,.25)";
  msg.style.color = "rgba(255,255,255,.9)";
  msg.innerHTML = `数据加载失败：<span style="font-family:ui-monospace,Menlo,Consolas,monospace">${String(
    err?.message ?? err,
  )}</span><br/>请用本地静态服务器打开本页面（例如 VSCode Live Server 或 Python http.server）。`;
  document.body.prepend(msg);
});
