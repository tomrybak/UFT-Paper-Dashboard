const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = __dirname;
const publicDir = path.join(root, "public");
const statePath = path.join(root, "data", "dashboard-state.json");
const paperDbPath = "/home/tom/.openclaw/workspace/uft_research/data/uft_theory_10000.sqlite";
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

function runSqliteJson(script, args = []) {
  const result = spawnSync("python3", ["-c", script, paperDbPath, ...args], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "SQLite query failed").trim());
  }
  return JSON.parse(result.stdout);
}

function paperMetrics() {
  return runSqliteJson(String.raw`
import json, sqlite3, sys
db = sys.argv[1]
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
cur = conn.cursor()
out = {}
out["paperCount"] = cur.execute("select count(*) from sources").fetchone()[0]
out["avgAbstractChars"] = round(cur.execute("select avg(length(coalesce(abstract,''))) from sources").fetchone()[0] or 0, 1)
out["avgTitleChars"] = round(cur.execute("select avg(length(coalesce(title,''))) from sources").fetchone()[0] or 0, 1)
out["laneCount"] = cur.execute("select count(distinct lane) from sources").fetchone()[0]
out["factorTagCount"] = cur.execute("select count(*) from source_factors").fetchone()[0]
out["solutionTagCount"] = cur.execute("select count(*) from source_solutions").fetchone()[0]
out["topLanes"] = [dict(r) for r in cur.execute("select lane, count(*) as count from sources group by lane order by count desc limit 12")]
out["topFactors"] = [dict(r) for r in cur.execute("select factor, count(*) as count from source_factors group by factor order by count desc limit 12")]
out["topSolutions"] = [dict(r) for r in cur.execute("select solution_type, count(*) as count from source_solutions group by solution_type order by count desc limit 10")]
out["years"] = [dict(r) for r in cur.execute("select year, count(*) as count from sources where year != '' group by year order by year desc limit 12")]
conn.close()
print(json.dumps(out))
`);
}

function paperSearch(query, lane, limit, offset) {
  return runSqliteJson(String.raw`
import json, sqlite3, sys
db, query, lane, limit, offset = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
limit = max(1, min(limit, 200))
offset = max(0, offset)
tokens = [t.lower() for t in query.replace(",", " ").split() if t.strip()]
where = []
params = []
if lane and lane != "all":
    where.append("lane = ?")
    params.append(lane)
for token in tokens:
    where.append("lower(coalesce(title,'') || ' ' || coalesce(abstract,'') || ' ' || coalesce(factor_tags,'') || ' ' || coalesce(solution_tags,'') || ' ' || coalesce(categories,'') || ' ' || coalesce(lane,'')) like ?")
    params.append(f"%{token}%")
where_sql = (" where " + " and ".join(where)) if where else ""
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
cur = conn.cursor()
total = cur.execute("select count(*) from sources" + where_sql, params).fetchone()[0]
rows = []
for r in cur.execute("""
    select arxiv_id, lane, lane_role, lane_family, year, published, title, authors, categories, url,
           factor_tags, solution_tags, abstract
    from sources
""" + where_sql + " order by published desc, arxiv_id desc limit ? offset ?", params + [limit, offset]):
    row = dict(r)
    abstract = row.get("abstract") or ""
    row["abstractPreview"] = abstract[:360] + ("..." if len(abstract) > 360 else "")
    row.pop("abstract", None)
    rows.append(row)
lanes = [dict(r) for r in cur.execute("select lane, count(*) as count from sources group by lane order by lane")]
conn.close()
print(json.dumps({"total": total, "limit": limit, "offset": offset, "rows": rows, "lanes": lanes}))
`, [query || "", lane || "all", String(limit), String(offset)]);
}

function paperDetail(arxivId) {
  return runSqliteJson(String.raw`
import json, sqlite3, sys
db, arxiv_id = sys.argv[1], sys.argv[2]
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
cur = conn.cursor()
row = cur.execute("select * from sources where arxiv_id = ?", (arxiv_id,)).fetchone()
if row is None:
    print(json.dumps({"found": False}))
else:
    out = dict(row)
    out["found"] = True
    out["factors"] = [r[0] for r in cur.execute("select factor from source_factors where arxiv_id = ? order by factor", (arxiv_id,))]
    out["solutions"] = [r[0] for r in cur.execute("select solution_type from source_solutions where arxiv_id = ? order by solution_type", (arxiv_id,))]
    out["similar"] = [dict(r) for r in cur.execute("""
        select source_a, source_b, jaccard, shared_count, shared_tags, title_a, title_b
        from source_similarity_edges
        where source_a = ? or source_b = ?
        order by jaccard desc, shared_count desc
        limit 8
    """, (arxiv_id, arxiv_id))]
    print(json.dumps(out))
conn.close()
`, [arxivId]);
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

server.listen(port, "127.0.0.1", () => {
  console.log(`UFT paper dashboard running at http://127.0.0.1:${port}/`);
});
