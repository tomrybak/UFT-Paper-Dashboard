# UFT Paper Dashboard

Local dashboard for tracking the UFT paper's publication readiness, research segmentation, issue queue, and investigation history.

## Run

```bash
cd /home/tom/.openclaw/workspace/uft-paper-dashboard
npm start
```

Default URL:

```text
http://localhost:8791/
```

Use another port with:

```bash
PORT=8792 npm start
```

## Node Hosting

Requires Node.js `>=22.12.0` because the server uses Node's built-in SQLite module for the paper database APIs.

Runtime settings:

- `PORT`: web server port, default `8791`
- `HOST`: bind address, default `0.0.0.0`
- `PAPER_DB_PATH`: optional path to the readable SQLite corpus database

By default, the server looks for `data/uft_theory_10000.sqlite` inside this repo, then falls back to the sibling local workspace database at `../uft_research/data/uft_theory_10000.sqlite`.

## Durable State

The recovery source of truth is:

```text
/home/tom/.openclaw/workspace/uft-paper-dashboard/data/dashboard-state.json
```

It stores:

- publish score history
- full paper section map
- segmented research status
- supporting data inventory
- ranked issue backlog
- selected issue IDs for the next resolution round
- investigation/change history
- source paths for the paper bundle and research workspace

Future sessions should read this JSON first, then inspect the referenced paper/research files only as needed.

## Standing UFT Workflow

When a session discusses the UFT paper, compact-phase theory, manuscript readiness, a new observation, or a next research round:

1. Read `data/dashboard-state.json`.
2. Add a `history` entry for the turn.
3. Add or revise issues/research sections/supporting data when the discussion changes the paper.
4. Update `scoreHistory` only when publication readiness materially changes.
5. Save the state before final response.
