const stateUrl = "/api/state";
let pageSize = 10;

let state = null;
let currentTab = "status";
let currentPage = 0;
let moduleFilter = "all";
let severityFilter = "all";
let draftSelectedIssueIds = [];
let activePaperId = null;
let preferenceSaveTimer = null;

const els = {
  tabs: Array.from(document.querySelectorAll(".tab")),
  panels: Array.from(document.querySelectorAll(".tab-panel")),
  paperTitle: document.getElementById("paperTitle"),
  selectedCount: document.getElementById("selectedCount"),
  sideIssueCount: document.getElementById("sideIssueCount"),
  saveStatus: document.getElementById("saveStatus"),
  scoreValue: document.getElementById("scoreValue"),
  scoreLabel: document.getElementById("scoreLabel"),
  scoreChart: document.getElementById("scoreChart"),
  statusSummary: document.getElementById("statusSummary"),
  currentVersion: document.getElementById("currentVersion"),
  openIssueCount: document.getElementById("openIssueCount"),
  topSeverity: document.getElementById("topSeverity"),
  publicationShape: document.getElementById("publicationShape"),
  recheckCycle: document.getElementById("recheckCycle"),
  overviewArticle: document.getElementById("overviewArticle"),
  fullPaperSections: document.getElementById("fullPaperSections"),
  researchSections: document.getElementById("researchSections"),
  insightSections: document.getElementById("insightSections"),
  supportingDataSections: document.getElementById("supportingDataSections"),
  issuesSummary: document.getElementById("issuesSummary"),
  issueList: document.getElementById("issueList"),
  moduleFilter: document.getElementById("moduleFilter"),
  severityFilter: document.getElementById("severityFilter"),
  issuePageSize: document.getElementById("issuePageSize"),
  selectAllIssues: document.getElementById("selectAllIssues"),
  clearSelection: document.getElementById("clearSelection"),
  submitFixSelection: document.getElementById("submitFixSelection"),
  prevPage: document.getElementById("prevPage"),
  nextPage: document.getElementById("nextPage"),
  pageLabel: document.getElementById("pageLabel"),
  historyList: document.getElementById("historyList"),
  historyForm: document.getElementById("historyForm"),
  historyTitle: document.getElementById("historyTitle"),
  historySummary: document.getElementById("historySummary"),
  historyImpact: document.getElementById("historyImpact"),
  recoveryBlock: document.getElementById("recoveryBlock"),
  sqlMetrics: document.getElementById("sqlMetrics"),
  paperSearchInput: document.getElementById("paperSearchInput"),
  paperLaneFilter: document.getElementById("paperLaneFilter"),
  paperResultLimit: document.getElementById("paperResultLimit"),
  paperSearchButton: document.getElementById("paperSearchButton"),
  paperResultsMeta: document.getElementById("paperResultsMeta"),
  paperResults: document.getElementById("paperResults"),
  paperReadingPane: document.getElementById("paperReadingPane")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setSaveStatus(text) {
  els.saveStatus.textContent = text;
}

function selectedSet() {
  return new Set(draftSelectedIssueIds || []);
}

function updateSelectedCount() {
  const count = draftSelectedIssueIds.length;
  els.selectedCount.textContent = String(count);
  els.sideIssueCount.textContent = String(openIssues().length);
}

function openIssues() {
  return state.issues.filter(issue => issue.status !== "resolved");
}

function severityWeight(severity) {
  return { blocker: 4, high: 3, medium: 2, low: 1 }[severity] || 0;
}

function filteredIssues() {
  return state.issues
    .filter(issue => moduleFilter === "all" || issue.module === moduleFilter)
    .filter(issue => severityFilter === "all" || issue.severity === severityFilter)
    .sort((a, b) => a.rank - b.rank);
}

function visibleIssues() {
  const issues = filteredIssues();
  if (pageSize === "all") return issues;
  const size = Number(pageSize) || 10;
  return issues.slice(currentPage * size, currentPage * size + size);
}

function switchTab(tab) {
  currentTab = tab;
  els.tabs.forEach(button => button.classList.toggle("active", button.dataset.tab === tab));
  els.panels.forEach(panel => panel.classList.toggle("active", panel.id === tab));
  if (tab === "status") drawScoreChart();
}

function renderStatus() {
  els.paperTitle.textContent = state.paper.title;
  els.scoreValue.textContent = `${state.publishScore.current}%`;
  els.scoreLabel.textContent = state.publishScore.label;
  els.statusSummary.textContent = state.statusSummary;
  els.currentVersion.textContent = state.paper.currentVersion;
  els.openIssueCount.textContent = String(openIssues().length);
  const top = openIssues().sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity))[0];
  els.topSeverity.textContent = top ? top.severity : "none";
  els.publicationShape.textContent = state.paper.recommendedPublicationShape;
  updateSelectedCount();
  drawScoreChart();
}

function drawScoreChart() {
  if (!state || currentTab !== "status") return;
  const canvas = els.scoreChart;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const width = rect.width;
  const height = rect.height;
  const pad = { left: 48, right: 18, top: 20, bottom: 46 };
  const points = state.scoreHistory;
  const minY = 35;
  const maxY = 75;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfcfd";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#d9e0e8";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#637083";
  ctx.font = "12px system-ui, sans-serif";
  for (let y = 40; y <= 70; y += 10) {
    const py = pad.top + (maxY - y) / (maxY - minY) * plotH;
    ctx.beginPath();
    ctx.moveTo(pad.left, py);
    ctx.lineTo(width - pad.right, py);
    ctx.stroke();
    ctx.fillText(`${y}%`, 10, py + 4);
  }

  const toX = index => pad.left + (points.length === 1 ? 0 : index / (points.length - 1) * plotW);
  const toY = score => pad.top + (maxY - score) / (maxY - minY) * plotH;

  ctx.strokeStyle = "#0f766e";
  ctx.lineWidth = 3;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = toX(index);
    const y = toY(point.score);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  points.forEach((point, index) => {
    const x = toX(index);
    const y = toY(point.score);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = index === points.length - 1 ? "#b45309" : "#0f766e";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#18202a";
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.fillText(String(point.score), x - 7, y - 12);
  });

  ctx.fillStyle = "#637083";
  ctx.font = "12px system-ui, sans-serif";
  points.forEach((point, index) => {
    const x = toX(index);
    const label = point.date.slice(5);
    ctx.save();
    ctx.translate(x, height - 16);
    ctx.rotate(-0.35);
    ctx.fillText(label, -18, 0);
    ctx.restore();
  });
}

function renderOverview() {
  const article = state.overviewArticle;
  const sections = article.sections.map(section => `
    <section class="article-section">
      <h3>${escapeHtml(section.heading)}</h3>
      <p>${escapeHtml(section.body)}</p>
    </section>
  `).join("");
  els.overviewArticle.innerHTML = `
    <h2>${escapeHtml(article.title)}</h2>
    <p class="lede">${escapeHtml(article.lede)}</p>
    ${sections}
  `;
}

function listItems(items) {
  return `<ul class="compact-list">${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderFullPaper() {
  const sections = state.fullPaperSections || [];
  els.fullPaperSections.innerHTML = sections.map(section => `
    <article class="paper-section-card">
      <div class="paper-section-head">
        <div>
          <p class="section-number">${escapeHtml(section.number || "")}</p>
          <h3>${escapeHtml(section.title)}</h3>
        </div>
        <span class="severity ${escapeHtml(section.readiness || "medium")}">${escapeHtml(section.readinessLabel || section.readiness || "review")}</span>
      </div>
      <p>${escapeHtml(section.summary)}</p>
      <div class="paper-section-columns">
        <div>
          <strong>Keep / strengthen</strong>
          ${listItems(section.keep || [])}
        </div>
        <div>
          <strong>Needs work</strong>
          ${listItems(section.needsWork || [])}
        </div>
      </div>
      <div class="source-line">${escapeHtml(section.source || "")}</div>
    </article>
  `).join("");
}

function renderResearchSections() {
  els.researchSections.innerHTML = state.researchSections.map(section => `
    <article class="research-row">
      <div>
        <h3>${escapeHtml(section.name)}</h3>
        <div class="research-meta">
          <span class="pill">${escapeHtml(section.posture)}</span>
          <span class="pill">${escapeHtml(section.status)}</span>
        </div>
      </div>
      <div>
        <p>${escapeHtml(section.summary)}</p>
      </div>
      <div>
        <strong>Completed</strong>
        ${listItems(section.completedAnalysis)}
        <strong>Next validation</strong>
        ${listItems(section.nextValidation)}
      </div>
    </article>
  `).join("");
}

function renderSupportingData() {
  const groups = state.supportingDataSections || [];
  els.supportingDataSections.innerHTML = groups.map(group => `
    <article class="data-card">
      <div class="data-card-head">
        <h3>${escapeHtml(group.name)}</h3>
        <span class="pill">${escapeHtml(group.status)}</span>
      </div>
      <p>${escapeHtml(group.summary)}</p>
      <div class="data-items">
        ${(group.items || []).map(item => `
          <div class="data-item">
            <strong>${escapeHtml(item.label)}</strong>
            <span>${escapeHtml(item.role)}</span>
            <code class="code-path">${escapeHtml(item.path)}</code>
          </div>
        `).join("")}
      </div>
      <strong>Next action</strong>
      ${listItems(group.nextActions || [])}
    </article>
  `).join("");
}

function renderRecheckCycle() {
  const cycle = state.recheckCycle;
  if (!cycle) {
    els.recheckCycle.innerHTML = `<div class="empty-state">No recheck cycle has been defined yet.</div>`;
    return;
  }
  const steps = (cycle.steps || []).map(step => `
    <article class="recheck-step">
      <div class="recheck-step-head">
        <span class="rank">${escapeHtml(step.order || "")}</span>
        <div>
          <h3>${escapeHtml(step.name)}</h3>
          <p>${escapeHtml(step.summary)}</p>
        </div>
      </div>
      ${step.outputs?.length ? `
        <strong>Outputs</strong>
        ${listItems(step.outputs)}
      ` : ""}
    </article>
  `).join("");
  els.recheckCycle.innerHTML = `
    <div class="recheck-head">
      <div>
        <p class="status-copy">${escapeHtml(cycle.summary || "")}</p>
        <p class="toolbar-copy">${escapeHtml(cycle.refinedFrom || "")}</p>
      </div>
      <span class="pill">${escapeHtml(cycle.status || "active")}</span>
    </div>
    <div class="recheck-grid">${steps}</div>
    <div class="recheck-footer">
      <div>
        <strong>Current handoff</strong>
        ${listItems(cycle.currentHandoff || [])}
      </div>
      <div>
        <strong>Completion rule</strong>
        <p class="toolbar-copy">${escapeHtml(cycle.completionRule || "")}</p>
      </div>
    </div>
  `;
}

function renderInsights() {
  const insights = state.insights || [];
  els.insightSections.innerHTML = insights.length ? insights.map(insight => `
    <article class="insight-card">
      <div class="insight-head">
        <div>
          <p class="section-number">${escapeHtml(insight.area || "Investigation")}</p>
          <h3>${escapeHtml(insight.title)}</h3>
        </div>
        <span class="pill">${escapeHtml(insight.status || "open")}</span>
      </div>
      <p>${escapeHtml(insight.summary)}</p>
      <div class="insight-columns">
        <div>
          <strong>Supporting signal</strong>
          ${listItems(insight.supportingSignals || [])}
        </div>
        <div>
          <strong>Next investigation</strong>
          ${listItems(insight.nextInvestigations || [])}
        </div>
      </div>
    </article>
  `).join("") : `
    <div class="empty-state">No insights have been recorded yet.</div>
  `;
}

function renderFilters() {
  const modules = Array.from(new Set(state.issues.map(issue => issue.module))).sort();
  if (moduleFilter !== "all" && !modules.includes(moduleFilter)) moduleFilter = "all";
  els.moduleFilter.innerHTML = `<option value="all">All</option>${modules.map(module => (
    `<option value="${escapeHtml(module)}">${escapeHtml(module)}</option>`
  )).join("")}`;
  els.moduleFilter.value = moduleFilter;
  els.severityFilter.value = severityFilter;
}

function applyIssueViewPreferences() {
  const prefs = state.issueViewPreferences || {};
  const page = String(prefs.pageSize || "10");
  const modules = new Set(["all", ...state.issues.map(issue => issue.module)]);
  const preferredModule = String(prefs.moduleFilter || "all");
  moduleFilter = modules.has(preferredModule) ? preferredModule : "all";
  severityFilter = ["all", "blocker", "high", "medium", "low"].includes(String(prefs.severityFilter))
    ? String(prefs.severityFilter)
    : "all";
  pageSize = page === "all" ? "all" : Number(page) || 10;
}

function persistIssueViewPreferences() {
  const issueViewPreferences = {
    moduleFilter,
    severityFilter,
    pageSize: String(pageSize)
  };
  state.issueViewPreferences = {
    ...(state.issueViewPreferences || {}),
    ...issueViewPreferences
  };
  clearTimeout(preferenceSaveTimer);
  preferenceSaveTimer = window.setTimeout(async () => {
    try {
      setSaveStatus("Saving issue view...");
      const response = await fetch("/api/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ issueViewPreferences })
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error || "Preference save failed");
      state.issueViewPreferences = payload.issueViewPreferences;
      setSaveStatus("Issue view saved");
    } catch (error) {
      setSaveStatus(error.message);
    }
  }, 250);
}

function renderIssues() {
  const selected = selectedSet();
  const issues = filteredIssues();
  const size = pageSize === "all" ? Math.max(1, issues.length) : Number(pageSize) || 10;
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(issues.length / size));
  currentPage = Math.min(currentPage, totalPages - 1);
  const pageIssues = visibleIssues();

  els.issueList.innerHTML = pageIssues.map(issue => {
    const checked = selected.has(issue.id) ? "checked" : "";
    const selectedClass = selected.has(issue.id) ? "selected" : "";
    const sources = (issue.sourceRefs || []).map(source => `<li>${escapeHtml(source)}</li>`).join("");
    return `
      <article class="issue-row ${selectedClass}" data-issue-id="${escapeHtml(issue.id)}">
        <div class="issue-main">
          <input class="issue-select" type="checkbox" ${checked} aria-label="Select ${escapeHtml(issue.title)}">
          <div class="issue-body" role="button" tabindex="0" aria-label="Show details for ${escapeHtml(issue.title)}">
            <div class="issue-title-line">
              <span class="rank">#${issue.rank}</span>
              <h3>${escapeHtml(issue.title)}</h3>
              <span class="severity ${escapeHtml(issue.severity)}">${escapeHtml(issue.severity)}</span>
              <span class="pill">${escapeHtml(issue.module)}</span>
            </div>
            <p class="issue-summary">${escapeHtml(issue.summary)}</p>
          </div>
          <button class="button muted expand-btn" type="button">Details</button>
        </div>
        <div class="issue-detail">
          <div class="detail-grid">
            <div>
              <strong>Detail</strong>
              <p>${escapeHtml(issue.detail)}</p>
              <strong>Proposed resolution approach</strong>
              <p>${escapeHtml(issue.resolutionApproach)}</p>
            </div>
            <div>
              <strong>Planning</strong>
              <ul class="source-list">
                <li>Effort: ${escapeHtml(issue.effort)}</li>
                <li>Impact: ${escapeHtml(issue.impact)}</li>
                <li>Status: ${escapeHtml(issue.status)}</li>
              </ul>
              <strong>Source refs</strong>
              <ul class="source-list">${sources}</ul>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join("");

  els.issuePageSize.value = String(pageSize);
  els.issuesSummary.textContent = `${issues.length} matching issues, ${draftSelectedIssueIds.length} selected. Sorted by priority.`;
  els.pageLabel.textContent = pageSize === "all"
    ? `Showing all ${issues.length}`
    : `Page ${currentPage + 1} of ${totalPages} - ${issues.length} issues`;
  els.prevPage.disabled = pageSize === "all" || currentPage === 0;
  els.nextPage.disabled = pageSize === "all" || currentPage >= totalPages - 1;

  els.issueList.querySelectorAll(".issue-row").forEach(row => {
    const id = row.dataset.issueId;
    row.querySelector(".issue-select").addEventListener("change", event => {
      const next = selectedSet();
      if (event.target.checked) next.add(id);
      else next.delete(id);
      draftSelectedIssueIds = Array.from(next);
      updateSelectedCount();
      renderIssues();
      setSaveStatus("Selection changed, not submitted");
    });
    const toggleRow = () => {
      row.classList.toggle("expanded");
      row.querySelector(".expand-btn").textContent = row.classList.contains("expanded") ? "Close" : "Details";
    };
    row.querySelector(".expand-btn").addEventListener("click", toggleRow);
    row.querySelector(".issue-body").addEventListener("click", toggleRow);
    row.querySelector(".issue-body").addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleRow();
      }
    });
  });
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

function splitTags(value) {
  return String(value || "")
    .split(/[;,|]/)
    .map(tag => tag.trim())
    .filter(Boolean);
}

function renderSqlMetricCard(label, value, detail = "") {
  return `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
    </article>
  `;
}

async function loadPaperMetrics() {
  els.sqlMetrics.innerHTML = `<div class="empty-state">Loading corpus metrics...</div>`;
  try {
    const response = await fetch("/api/paper-metrics");
    const metrics = await response.json();
    if (!response.ok) throw new Error(metrics.error || "Metrics failed");
    const topLane = (metrics.topLanes || [])[0];
    const topFactor = (metrics.topFactors || [])[0];
    els.sqlMetrics.innerHTML = [
      renderSqlMetricCard("Papers", formatNumber(metrics.paperCount), "rows in sources"),
      renderSqlMetricCard("Avg abstract", `${formatNumber(metrics.avgAbstractChars)} chars`, "mean stored abstract length"),
      renderSqlMetricCard("Avg title", `${formatNumber(metrics.avgTitleChars)} chars`, "mean title length"),
      renderSqlMetricCard("Lanes", formatNumber(metrics.laneCount), topLane ? `${topLane.lane}: ${formatNumber(topLane.count)}` : ""),
      renderSqlMetricCard("Factor tags", formatNumber(metrics.factorTagCount), topFactor ? `${topFactor.factor}: ${formatNumber(topFactor.count)}` : ""),
      renderSqlMetricCard("Solution tags", formatNumber(metrics.solutionTagCount), "classified solution patterns")
    ].join("");
  } catch (error) {
    els.sqlMetrics.innerHTML = `<div class="empty-state error-state">${escapeHtml(error.message)}</div>`;
  }
}

function populatePaperLanes(lanes) {
  const prior = els.paperLaneFilter.value || "all";
  els.paperLaneFilter.innerHTML = `
    <option value="all">All lanes</option>
    ${(lanes || []).map(lane => (
      `<option value="${escapeHtml(lane.lane)}">${escapeHtml(lane.lane)} (${formatNumber(lane.count)})</option>`
    )).join("")}
  `;
  const values = Array.from(els.paperLaneFilter.options).map(option => option.value);
  els.paperLaneFilter.value = values.includes(prior) ? prior : "all";
}

function renderPaperResults(payload) {
  populatePaperLanes(payload.lanes || []);
  const rows = payload.rows || [];
  const shownEnd = Math.min(payload.total || 0, (payload.offset || 0) + rows.length);
  els.paperResultsMeta.textContent = `${formatNumber(rows.length)} shown of ${formatNumber(payload.total)} matches${shownEnd ? `, through ${formatNumber(shownEnd)}` : ""}.`;
  els.paperResults.innerHTML = rows.length ? rows.map(row => {
    const selectedClass = row.arxiv_id === activePaperId ? "selected" : "";
    const tags = splitTags(row.factor_tags || row.solution_tags).slice(0, 4);
    return `
      <article class="paper-result ${selectedClass}" data-arxiv-id="${escapeHtml(row.arxiv_id)}">
        <div class="paper-result-title">
          <strong>${escapeHtml(row.title || row.arxiv_id)}</strong>
          <span>${escapeHtml(row.year || "")}</span>
        </div>
        <div class="paper-result-meta">${escapeHtml(row.lane || "unlabeled")} ${row.primary_category ? `- ${escapeHtml(row.primary_category)}` : ""}</div>
        <p>${escapeHtml(row.abstractPreview || "No abstract preview available.")}</p>
        <div class="paper-tags">
          ${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}
        </div>
      </article>
    `;
  }).join("") : `<div class="empty-state">No papers match this search.</div>`;

  els.paperResults.querySelectorAll(".paper-result").forEach(row => {
    row.addEventListener("click", () => loadPaperDetail(row.dataset.arxivId));
  });
}

async function searchPapers() {
  const params = new URLSearchParams({
    query: els.paperSearchInput.value.trim(),
    lane: els.paperLaneFilter.value || "all",
    limit: els.paperResultLimit.value || "25",
    offset: "0"
  });
  els.paperResultsMeta.textContent = "Searching corpus...";
  try {
    const response = await fetch(`/api/papers?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Search failed");
    renderPaperResults(payload);
  } catch (error) {
    els.paperResultsMeta.textContent = error.message;
    els.paperResults.innerHTML = `<div class="empty-state error-state">${escapeHtml(error.message)}</div>`;
  }
}

async function loadPaperDetail(arxivId) {
  activePaperId = arxivId;
  els.paperReadingPane.innerHTML = `<div class="empty-state">Loading paper...</div>`;
  try {
    const response = await fetch(`/api/papers/${encodeURIComponent(arxivId)}`);
    const paper = await response.json();
    if (!response.ok) throw new Error(paper.error || "Paper load failed");
    if (!paper.found) throw new Error("Paper not found");
    renderPaperDetail(paper);
    els.paperResults.querySelectorAll(".paper-result").forEach(row => {
      row.classList.toggle("selected", row.dataset.arxivId === arxivId);
    });
  } catch (error) {
    els.paperReadingPane.innerHTML = `<div class="empty-state error-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderPaperDetail(paper) {
  const factors = (paper.factors || splitTags(paper.factor_tags)).slice(0, 20);
  const solutions = (paper.solutions || splitTags(paper.solution_tags)).slice(0, 20);
  const similar = paper.similar || [];
  els.paperReadingPane.innerHTML = `
    <article class="paper-reader">
      <div class="paper-reader-head">
        <div>
          <p class="section-number">${escapeHtml(paper.arxiv_id)}</p>
          <h3>${escapeHtml(paper.title || "Untitled paper")}</h3>
        </div>
        ${paper.url ? `<a class="button muted text-link" href="${escapeHtml(paper.url)}" target="_blank" rel="noreferrer">Open source</a>` : ""}
      </div>
      <div class="reader-meta">
        <span>${escapeHtml(paper.year || "unknown year")}</span>
        <span>${escapeHtml(paper.lane || "unlabeled lane")}</span>
        <span>${escapeHtml(paper.categories || "")}</span>
      </div>
      <p class="authors">${escapeHtml(paper.authors || "Unknown authors")}</p>
      <h4>Abstract</h4>
      <p>${escapeHtml(paper.abstract || "No abstract stored for this source.")}</p>
      <h4>Factor tags</h4>
      <div class="paper-tags">${factors.map(tag => `<span>${escapeHtml(tag)}</span>`).join("") || "<span>none</span>"}</div>
      <h4>Solution tags</h4>
      <div class="paper-tags">${solutions.map(tag => `<span>${escapeHtml(tag)}</span>`).join("") || "<span>none</span>"}</div>
      <h4>Similar corpus neighbors</h4>
      ${similar.length ? listItems(similar.map(edge => {
        const otherId = edge.source_a === paper.arxiv_id ? edge.source_b : edge.source_a;
        const otherTitle = edge.source_a === paper.arxiv_id ? edge.title_b : edge.title_a;
        return `${otherId}: ${otherTitle || "untitled"} (${Number(edge.jaccard || 0).toFixed(2)} tag overlap)`;
      })) : `<p class="toolbar-copy">No similarity edges stored for this paper.</p>`}
    </article>
  `;
}

async function persistSelection(ids, submitted = false) {
  state.selectedIssueIds = ids;
  draftSelectedIssueIds = ids;
  updateSelectedCount();
  setSaveStatus("Saving...");
  const response = await fetch("/api/selection", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selectedIssueIds: ids, submitted })
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || "Selection save failed");
  state.selectedIssueIds = payload.selectedIssueIds;
  state.lastFixSubmission = payload.lastFixSubmission || state.lastFixSubmission || null;
  draftSelectedIssueIds = payload.selectedIssueIds;
  updateSelectedCount();
  renderIssues();
  renderRecovery();
  setSaveStatus(submitted ? "Fix queue submitted" : "Selection saved");
}

function renderHistory() {
  els.historyList.innerHTML = state.history.map(item => `
    <article class="history-item">
      <div>
        <div class="history-date">${escapeHtml(item.date)}</div>
        <span class="pill">${escapeHtml(item.type)}</span>
      </div>
      <div>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.summary)}</p>
        <p><strong>Impact:</strong> ${escapeHtml(item.impact)}</p>
      </div>
    </article>
  `).join("");
}

function renderRecovery() {
  const selected = state.selectedIssueIds
    .map(id => state.issues.find(issue => issue.id === id))
    .filter(Boolean);
  els.recoveryBlock.innerHTML = `
    <p>Durable state file</p>
    <code class="code-path">/home/tom/.openclaw/workspace/uft-paper-dashboard/data/dashboard-state.json</code>
    <p>Last submitted fix queue</p>
    <p>${state.lastFixSubmission ? `${escapeHtml(state.lastFixSubmission.count)} issues submitted on ${escapeHtml(state.lastFixSubmission.date)}` : "No submitted fix queue yet."}</p>
    <p>Selected next-round queue</p>
    ${selected.length ? listItems(selected.map(issue => `#${issue.rank} ${issue.title}`)) : "<p>No selected issues yet.</p>"}
    <p>Source paths</p>
    ${state.sources.map(source => `
      <div>
        <strong>${escapeHtml(source.label)}</strong>
        <code class="code-path">${escapeHtml(source.path)}</code>
      </div>
    `).join("")}
  `;
}

function renderAll() {
  renderStatus();
  renderRecheckCycle();
  renderOverview();
  renderFullPaper();
  renderResearchSections();
  renderInsights();
  renderSupportingData();
  renderFilters();
  renderIssues();
  renderHistory();
  renderRecovery();
}

async function loadState() {
  const response = await fetch(stateUrl);
  state = await response.json();
  draftSelectedIssueIds = Array.isArray(state.selectedIssueIds) ? [...state.selectedIssueIds] : [];
  applyIssueViewPreferences();
  renderAll();
  loadPaperMetrics();
  searchPapers();
  setSaveStatus("State loaded");
}

els.tabs.forEach(button => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

els.moduleFilter.addEventListener("change", event => {
  moduleFilter = event.target.value;
  currentPage = 0;
  renderIssues();
  persistIssueViewPreferences();
});

els.severityFilter.addEventListener("change", event => {
  severityFilter = event.target.value;
  currentPage = 0;
  renderIssues();
  persistIssueViewPreferences();
});

els.issuePageSize.addEventListener("change", event => {
  pageSize = event.target.value === "all" ? "all" : Number(event.target.value);
  currentPage = 0;
  renderIssues();
  persistIssueViewPreferences();
});

els.prevPage.addEventListener("click", () => {
  currentPage = Math.max(0, currentPage - 1);
  renderIssues();
});

els.nextPage.addEventListener("click", () => {
  currentPage += 1;
  renderIssues();
});

els.selectAllIssues.addEventListener("click", () => {
  draftSelectedIssueIds = state.issues
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map(issue => issue.id);
  updateSelectedCount();
  renderIssues();
  setSaveStatus("All issues selected, not submitted");
});

els.clearSelection.addEventListener("click", () => {
  draftSelectedIssueIds = [];
  updateSelectedCount();
  renderIssues();
  setSaveStatus("Selection cleared, not submitted");
});

els.submitFixSelection.addEventListener("click", () => {
  persistSelection(draftSelectedIssueIds, true);
});

els.paperSearchButton.addEventListener("click", searchPapers);

els.paperSearchInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    searchPapers();
  }
});

els.paperLaneFilter.addEventListener("change", searchPapers);
els.paperResultLimit.addEventListener("change", searchPapers);

els.historyForm.addEventListener("submit", async event => {
  event.preventDefault();
  setSaveStatus("Saving...");
  const response = await fetch("/api/history", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: els.historyTitle.value,
      summary: els.historySummary.value,
      impact: els.historyImpact.value
    })
  });
  const payload = await response.json();
  if (!payload.ok) {
    setSaveStatus(payload.error || "Save failed");
    return;
  }
  state.history = payload.history;
  els.historyForm.reset();
  renderHistory();
  setSaveStatus("History saved");
});

window.addEventListener("resize", drawScoreChart);

loadState().catch(error => {
  setSaveStatus(error.message);
});
