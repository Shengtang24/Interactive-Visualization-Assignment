/* global d3 */

const App = (() => {
  const DATA_URL = "./emissions.json";

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
    chkKyoto: document.getElementById("chkKyoto"),
    chkPoints: document.getElementById("chkPoints"),
  };

  const state = {
    dataRaw: [],
    byCountry: new Map(), // country -> [{year, value|null}]
    definedByCountry: new Map(), // country -> [{year, value}]
    years: [],
    yearExtent: [1990, 2019],
    selected: new Set(),
    hidden: new Set(), // selected but temporarily hidden via legend
    mode: "absolute", // "absolute" | "indexed"
    showKyoto: true,
    showPoints: false,
    brushDomain: null, // [y0, y1] in years; null means full
    hoverYear: null,
    hoverCountry: null,
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
    if (state.mode === "absolute") return value;
    const [y0, y1] = getActiveDomain();
    const defined = state.definedByCountry.get(country) ?? [];
    // baseline = brush range 内第一个有效值
    const base = defined.find((d) => d.year >= y0 && d.year <= y1)?.value ?? defined[0]?.value ?? null;
    if (base == null || base === 0) return null;
    return (value / base) * 100;
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

    el.modeAbsolute.addEventListener("click", () => {
      state.mode = "absolute";
      el.modeAbsolute.classList.add("is-active");
      el.modeIndexed.classList.remove("is-active");
      el.modeAbsolute.setAttribute("aria-selected", "true");
      el.modeIndexed.setAttribute("aria-selected", "false");
      renderAll();
    });
    el.modeIndexed.addEventListener("click", () => {
      state.mode = "indexed";
      el.modeIndexed.classList.add("is-active");
      el.modeAbsolute.classList.remove("is-active");
      el.modeIndexed.setAttribute("aria-selected", "true");
      el.modeAbsolute.setAttribute("aria-selected", "false");
      renderAll();
    });

    el.chkKyoto.addEventListener("change", (e) => {
      state.showKyoto = e.target.checked;
      renderAll();
    });
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

    const kyotoG = g.append("g").attr("class", "kyoto");
    const linesG = g.append("g").attr("clip-path", `url(#${clipId})`);
    const pointsG = g.append("g").attr("clip-path", `url(#${clipId})`);
    const hoverG = g.append("g").attr("clip-path", `url(#${clipId})`);

    const crosshair = hoverG.append("line").attr("class", "crosshair").style("opacity", 0);

    const overlay = g.append("rect").attr("fill", "transparent").style("cursor", "crosshair");

    const xFull = d3.scaleLinear();
    const x = d3.scaleLinear();
    const y = d3.scaleLinear();
    let isSyncingZoom = false;

    const line = d3
      .line()
      .defined((d) => d.value != null)
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

      // Kyoto annotation
      kyotoG.selectAll("*").remove();
      if (state.showKyoto && xDomain[0] <= 2005 && xDomain[1] >= 2005) {
        const xk = x(2005);
        kyotoG
          .append("line")
          .attr("class", "kyoto-line")
          .attr("x1", xk)
          .attr("x2", xk)
          .attr("y1", 0)
          .attr("y2", innerH);
        kyotoG
          .append("text")
          .attr("class", "kyoto-label")
          .attr("x", xk + 6)
          .attr("y", 12)
          .text("2005 京都生效");
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
        const [mx] = d3.pointer(event, overlay.node());
        const year = Math.round(x.invert(mx));
        const clamped = Math.max(xDomain[0], Math.min(xDomain[1], year));
        state.hoverYear = clamped;

        const activeCountries = selected.filter((c) => !state.hidden.has(c));
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

      overlay.on("mouseleave", () => {
        state.hoverYear = null;
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
      const title = state.mode === "absolute" ? `${year} 年（原始值）` : `${year} 年（指数化）`;
      const top = rows.slice(0, 9);

      const unitHint = state.mode === "absolute" ? "" : "<span style='color:rgba(255,255,255,.6)'>（区间起点=100）</span>";
      el.tooltip.innerHTML = `
        <div class="tt-title">${title} ${unitHint}</div>
        ${top
          .map((r) => {
            const v = state.mode === "absolute" ? fmtValue(r.value) : fmtValue(r.tvalue);
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
    const margin = { top: 14, right: 18, bottom: 26, left: 54 };
    let width = 800;
    let height = 120;

    const x = d3.scaleLinear();
    const y = d3.scaleLinear();
    const xAxisG = g.append("g").attr("class", "axis axis-x");
    const yAxisG = g.append("g").attr("class", "axis axis-y");
    const pathG = g.append("g");
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
