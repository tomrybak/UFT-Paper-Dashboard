const http = require("http");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const root = __dirname;
const publicDir = path.join(root, "public");
const statePath = path.join(root, "data", "dashboard-state.json");
const paperDbPath = process.env.PAPER_DB_PATH || firstExistingPath([
  path.join(root, "data", "uft_theory_10000.sqlite"),
  path.resolve(root, "..", "uft_research", "data", "uft_theory_10000.sqlite")
]);
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 8791);

const VALID_STATUSES = new Set(["new", "in_progress", "stalled", "completed"]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

function firstExistingPath(candidates) {
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

function readState() {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  let dirty = false;

  // Migrate old status values and ensure statusUpdatedAt field exists
  for (const issue of (state.issues || [])) {
    if (issue.status === "open") { issue.status = "new"; dirty = true; }
    if (issue.status === "resolved") { issue.status = "completed"; dirty = true; }
    if (!("statusUpdatedAt" in issue)) { issue.statusUpdatedAt = null; dirty = true; }
  }

  // Ensure settings exist
  if (!state.settings) {
    state.settings = { stallTimeoutMs: 3600000 };
    dirty = true;
  } else if (!state.settings.stallTimeoutMs) {
    state.settings.stallTimeoutMs = 3600000;
    dirty = true;
  }

  // Auto-detect stalled issues
  const stallMs = state.settings.stallTimeoutMs;
  const now = Date.now();
  for (const issue of (state.issues || [])) {
    if (issue.status === "in_progress" && issue.statusUpdatedAt) {
      if (now - new Date(issue.statusUpdatedAt).getTime() > stallMs) {
        issue.status = "stalled";
        issue.statusUpdatedAt = new Date().toISOString();
        dirty = true;
      }
    }
  }

  if (dirty) writeState(state);
  return state;
}

function writeState(state) {
  state.lastUpdated = new Date().toISOString();
  const tmpPath = `${statePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmpPath, statePath);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const requested = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(publicDir, requested));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "content-type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function withPaperDb(callback) {
  if (!fs.existsSync(paperDbPath)) {
    throw new Error(`Paper database not found at ${paperDbPath}. Set PAPER_DB_PATH to a readable SQLite database.`);
  }

  const db = new DatabaseSync(paperDbPath, { readOnly: true });
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function sqliteValue(db, sql, params = []) {
  const row = db.prepare(sql).get(...params);
  return row ? Object.values(row)[0] : null;
}

function sqliteRows(db, sql, params = []) {
  return db.prepare(sql).all(...params);
}

function paperMetrics() {
  return withPaperDb(db => ({
    paperCount: sqliteValue(db, "select count(*) from sources"),
    avgAbstractChars: Math.round((sqliteValue(db, "select avg(length(coalesce(abstract,''))) from sources") || 0) * 10) / 10,
    avgTitleChars: Math.round((sqliteValue(db, "select avg(length(coalesce(title,''))) from sources") || 0) * 10) / 10,
    laneCount: sqliteValue(db, "select count(distinct lane) from sources"),
    factorTagCount: sqliteValue(db, "select count(*) from source_factors"),
    solutionTagCount: sqliteValue(db, "select count(*) from source_solutions"),
    topLanes: sqliteRows(db, "select lane, count(*) as count from sources group by lane order by count desc limit 12"),
    topFactors: sqliteRows(db, "select factor, count(*) as count from source_factors group by factor order by count desc limit 12"),
    topSolutions: sqliteRows(db, "select solution_type, count(*) as count from source_solutions group by solution_type order by count desc limit 10"),
    years: sqliteRows(db, "select year, count(*) as count from sources where year != '' group by year order by year desc limit 12")
  }));
}

function paperSearch(query, lane, limit, offset) {
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 25, 200));
  const normalizedOffset = Math.max(0, Number(offset) || 0);
  const tokens = String(query || "")
    .replace(/,/g, " ")
    .split(/\s+/)
    .map(token => token.trim().toLowerCase())
    .filter(Boolean);
  const where = [];
  const params = [];

  if (lane && lane !== "all") {
    where.push("lane = ?");
    params.push(lane);
  }

  for (const token of tokens) {
    where.push("lower(coalesce(title,'') || ' ' || coalesce(abstract,'') || ' ' || coalesce(factor_tags,'') || ' ' || coalesce(solution_tags,'') || ' ' || coalesce(categories,'') || ' ' || coalesce(lane,'')) like ?");
    params.push(`%${token}%`);
  }

  const whereSql = where.length ? ` where ${where.join(" and ")}` : "";

  return withPaperDb(db => {
    const total = sqliteValue(db, `select count(*) from sources${whereSql}`, params);
    const rows = sqliteRows(db, `
      select arxiv_id, lane, lane_role, lane_family, year, published, title, authors, categories, url,
             factor_tags, solution_tags, abstract
      from sources
      ${whereSql}
      order by published desc, arxiv_id desc
      limit ? offset ?
    `, [...params, normalizedLimit, normalizedOffset]).map(row => {
      const { abstract = "", ...paper } = row;
      return {
        ...paper,
        abstractPreview: abstract.slice(0, 360) + (abstract.length > 360 ? "..." : "")
      };
    });
    const lanes = sqliteRows(db, "select lane, count(*) as count from sources group by lane order by lane");

    return {
      total,
      limit: normalizedLimit,
      offset: normalizedOffset,
      rows,
      lanes
    };
  });
}

function paperDetail(arxivId) {
  return withPaperDb(db => {
    const row = db.prepare("select * from sources where arxiv_id = ?").get(arxivId);
    if (!row) return { found: false };

    return {
      ...row,
      found: true,
      factors: sqliteRows(db, "select factor from source_factors where arxiv_id = ? order by factor", [arxivId]).map(item => item.factor),
      solutions: sqliteRows(db, "select solution_type from source_solutions where arxiv_id = ? order by solution_type", [arxivId]).map(item => item.solution_type),
      similar: sqliteRows(db, `
        select source_a, source_b, jaccard, shared_count, shared_tags, title_a, title_b
        from source_similarity_edges
        where source_a = ? or source_b = ?
        order by jaccard desc, shared_count desc
        limit 8
      `, [arxivId, arxivId])
    };
  });
}

function normalizeIssueViewPreferences(state, input = {}) {
  const current = state.issueViewPreferences || {};
  const modules = new Set(["all", ...state.issues.map(issue => issue.module)]);
  const severities = new Set(["all", "blocker", "high", "medium", "low"]);
  const pageSizes = new Set(["10", "20", "30", "all"]);
  const next = {
    moduleFilter: modules.has(String(input.moduleFilter ?? current.moduleFilter)) ? String(input.moduleFilter ?? current.moduleFilter) : "all",
    severityFilter: severities.has(String(input.severityFilter ?? current.severityFilter)) ? String(input.severityFilter ?? current.severityFilter) : "all",
    pageSize: pageSizes.has(String(input.pageSize ?? current.pageSize)) ? String(input.pageSize ?? current.pageSize) : "10",
    updatedAt: new Date().toISOString()
  };
  return next;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, readState());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/settings") {
      const state = readState();
      sendJson(res, 200, { ok: true, settings: state.settings });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/settings") {
      const payload = JSON.parse(await readRequestBody(req) || "{}");
      const state = readState();
      const current = state.settings || { stallTimeoutMs: 3600000 };
      if (payload.stallTimeoutMs != null) {
        const ms = Number(payload.stallTimeoutMs);
        if (ms > 0 && ms <= 86400000 * 7) {
          current.stallTimeoutMs = ms;
        }
      }
      state.settings = current;
      writeState(state);
      sendJson(res, 200, { ok: true, settings: state.settings });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/issue-status") {
      const payload = JSON.parse(await readRequestBody(req) || "{}");
      const state = readState();
      const issue = (state.issues || []).find(i => i.id === payload.issueId);
      if (!issue) {
        sendJson(res, 404, { ok: false, error: "Issue not found" });
        return;
      }
      if (!VALID_STATUSES.has(payload.status)) {
        sendJson(res, 400, { ok: false, error: "Invalid status" });
        return;
      }
      issue.status = payload.status;
      issue.statusUpdatedAt = new Date().toISOString();
      writeState(state);
      sendJson(res, 200, { ok: true, issue: { id: issue.id, status: issue.status, statusUpdatedAt: issue.statusUpdatedAt } });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/preferences") {
      const payload = JSON.parse(await readRequestBody(req) || "{}");
      const state = readState();
      state.issueViewPreferences = normalizeIssueViewPreferences(state, payload.issueViewPreferences || payload);
      writeState(state);
      sendJson(res, 200, {
        ok: true,
        issueViewPreferences: state.issueViewPreferences
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/paper-metrics") {
      sendJson(res, 200, paperMetrics());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/papers") {
      const query = url.searchParams.get("query") || "";
      const lane = url.searchParams.get("lane") || "all";
      const limit = Number(url.searchParams.get("limit") || 25);
      const offset = Number(url.searchParams.get("offset") || 0);
      sendJson(res, 200, paperSearch(query, lane, limit, offset));
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/papers/")) {
      const arxivId = decodeURIComponent(url.pathname.slice("/api/papers/".length));
      sendJson(res, 200, paperDetail(arxivId));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/selection") {
      const payload = JSON.parse(await readRequestBody(req) || "{}");
      const state = readState();
      const validIds = new Set(state.issues.map(issue => issue.id));
      const selectedIssueIds = Array.isArray(payload.selectedIssueIds)
        ? payload.selectedIssueIds.filter(id => validIds.has(id))
        : state.selectedIssueIds;
      state.selectedIssueIds = Array.from(new Set(selectedIssueIds));
      if (payload.submitted === true) {
        const submission = {
          id: `fix-${Date.now()}`,
          date: new Date().toISOString(),
          issueIds: state.selectedIssueIds,
          count: state.selectedIssueIds.length
        };
        state.fixQueueSubmissions = Array.isArray(state.fixQueueSubmissions)
          ? state.fixQueueSubmissions
          : [];
        state.fixQueueSubmissions.unshift(submission);
        state.lastFixSubmission = submission;
      }
      writeState(state);
      sendJson(res, 200, {
        ok: true,
        selectedIssueIds: state.selectedIssueIds,
        lastFixSubmission: state.lastFixSubmission || null
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/history") {
      const payload = JSON.parse(await readRequestBody(req) || "{}");
      const title = String(payload.title || "").trim();
      const summary = String(payload.summary || "").trim();
      if (!title || !summary) {
        sendJson(res, 400, { ok: false, error: "title and summary are required" });
        return;
      }
      const state = readState();
      state.history.unshift({
        id: `hist-${Date.now()}`,
        date: new Date().toISOString().slice(0, 10),
        type: "session-note",
        title,
        summary,
        impact: String(payload.impact || "Logged for continuity.").trim(),
        sources: Array.isArray(payload.sources) ? payload.sources.slice(0, 8) : []
      });
      writeState(state);
      sendJson(res, 200, { ok: true, history: state.history });
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`UFT paper dashboard running at http://localhost:${port}/`);
});
