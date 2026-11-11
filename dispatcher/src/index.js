// Dispatcher: a cron every minute. It reads the tracker, posts the pick-up comment on each new issue at
// once (from code, so pick-up never waits on a model), and starts one GitHub Actions run at a time:
// owner answers first, then new issues, oldest first. It holds no model logic and serves no endpoint.

const UA = 'sched-prod-dispatcher';
const WORKFLOW = 'work-issue.yml';

async function tracker(env, method, path, body) {
  const res = await fetch(env.TRACKER_URL.replace(/\/+$/, '') + path, {
    method,
    headers: {
      Authorization: `Bearer ${env.TRACKER_TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`tracker ${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function gh(env, method, path, body) {
  const res = await fetch(`${env.GH_API ?? 'https://api.github.com'}/repos/${env.GH_REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': UA,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`github ${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? {} : res.json().catch(() => ({}));
}

async function ping(env, title, message) {
  if (!env.NTFY_TOPIC) return;
  const headers = { Title: title, Tags: 'robot' };
  if (env.NTFY_TOKEN) headers.Authorization = `Bearer ${env.NTFY_TOKEN}`;
  if (env.ROUND_PAGE) headers.Click = env.ROUND_PAGE;
  const res = await fetch(`https://ntfy.sh/${encodeURIComponent(env.NTFY_TOPIC)}`, { method: 'POST', headers, body: message });
  console.log(`ntfy ${title} -> ${res.status}`);
}

async function dispatch(env, job) {
  await gh(env, 'POST', `/actions/workflows/${WORKFLOW}/dispatches`, {
    ref: 'main',
    inputs: { issue: String(job.issue), reason: job.reason },
  });
  await env.STATE.put('last', JSON.stringify(job));
  console.log(`dispatched #${job.issue} ${job.reason} attempt ${job.attempts}`);
}

async function tick(env) {
  if (!env.TRACKER_URL || !env.TRACKER_TOKEN || !env.GH_DISPATCH_TOKEN) return console.log('not configured');
  if (await env.STATE.get('off')) return console.log('off');
  const now = Date.now();
  const { issues = [] } = await tracker(env, 'GET', '/issues');
  const { text = '' } = await tracker(env, 'GET', '/shiplog');
  const shipped = new Set([...text.matchAll(/^#(\d+) ·/gm)].map((m) => Number(m[1])));
  issues.sort((a, b) => String(a.openedAt).localeCompare(String(b.openedAt)));

  // 1. Pick-up: a comment on every issue the agent has not touched yet.
  for (const i of issues) {
    if ((i.thread ?? []).some((e) => e.by === 'agent')) continue;
    await tracker(env, 'POST', `/issues/${i.n}/comments`, {
      body: `#${i.n} picked up by the agent at ${new Date(now).toISOString()}. It is in the work queue; the ship line follows when it is done.`,
    });
    console.log(`picked up #${i.n}`);
  }

  // 2. One run at a time.
  const { workflow_runs: runs = [] } = await gh(env, 'GET', `/actions/workflows/${WORKFLOW}/runs?per_page=10`);
  if (runs.some((r) => r.status !== 'completed')) return console.log('a run is active');
  const last = JSON.parse((await env.STATE.get('last')) ?? 'null');
  if (last && now - last.at < 60_000) return console.log('just dispatched');

  // 3. Retry the last job if its run failed (at most 3 tries).
  if (last && !last.done) {
    const name = `issue ${last.issue} ${last.reason}`;
    const run = runs.find((r) => (r.display_title ?? r.name) === name && Date.parse(r.created_at) >= last.at - 10_000);
    if (!run && now - last.at < 5 * 60_000) return console.log('waiting for the run to show');
    if (!run || run.conclusion !== 'success') {
      if (last.attempts < 3) return dispatch(env, { ...last, at: now, attempts: last.attempts + 1 });
      await ping(env, `#${last.issue} stuck`, `The agent run for #${last.issue} (${last.reason}) failed 3 times.`);
    }
    await env.STATE.put('last', JSON.stringify({ ...last, done: true }));
  }

  // 4. Owner answers first: an owner entry newer than the one last handled.
  for (const i of issues) {
    const owner = (i.thread ?? []).filter((e) => e.by === 'owner' && e.kind === 'comment').at(-1);
    if (!owner) continue;
    const seen = await env.STATE.get(`o:${i.n}`);
    if (seen && seen >= owner.at) continue;
    await env.STATE.put(`o:${i.n}`, owner.at);
    return dispatch(env, { issue: i.n, reason: 'owner', at: now, attempts: 1 });
  }

  // 5. Then new issues, oldest first.
  for (const i of issues) {
    if (i.closed || shipped.has(i.n)) continue;
    if (await env.STATE.get(`n:${i.n}`)) continue;
    await env.STATE.put(`n:${i.n}`, '1');
    return dispatch(env, { issue: i.n, reason: 'new', at: now, attempts: 1 });
  }
  console.log('queue empty');
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env).catch((e) => console.log(`tick failed: ${e.message}`)));
  },
  async fetch() {
    return Response.json({ error: 'not found' }, { status: 404 });
  },
};
