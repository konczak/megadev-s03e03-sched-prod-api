// After Codex runs: check its result, then ship it. Code makes every outside move; the model made the call.
// Usage: node agent/apply.mjs <issue>
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tracker, ping, issueNumber, env } from './lib.mjs';

const n = issueNumber(process.argv[2]);
const LIVE = env('LIVE_URL').replace(/\/+$/, '');
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });

// 1. Read and check the result.
let raw = readFileSync('.work/result.json', 'utf8').trim();
raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
const r = JSON.parse(raw);
const DECISIONS = ['build', 'decline', 'close', 'ask', 'wait'];
if (!DECISIONS.includes(r.decision)) throw new Error(`bad decision ${r.decision}`);
if (typeof r.comment !== 'string' || !r.comment.trim()) throw new Error('empty comment');
if (r.decision === 'ask' && !r.record) throw new Error('ask needs a record');
if (r.record) {
  const m = /^(\d{4})-[a-z0-9-]+$/.exec(r.record.id ?? '');
  if (!m || Number(m[1]) < 7) throw new Error(`bad record id ${r.record.id}`);
  if (!/status:\s*(proposed|accepted)/.test(r.record.text)) throw new Error('record has no status');
}
const risks = (r.risks ?? []).map((s) => String(s).replace(/[|\n]/g, ' ').trim()).filter(Boolean);
console.log(`result: ${r.decision} — ${r.summary}`);

// 2. Check what Codex changed.
const changed = sh('git', ['status', '--porcelain'])
  .split('\n').filter(Boolean).map((l) => l.slice(3).trim().replace(/^"|"$/g, ''))
  .filter((p) => !p.startsWith('.work/'));
const ALLOWED = (p) => p.startsWith('src/') || p === 'contract/api.md' || p === 'README.md';
const discard = () => { sh('git', ['checkout', '--', '.']); sh('git', ['clean', '-fdq', '-e', '.work/', '-e', 'node_modules/']); };

let live = false;
let verb = { build: 'shipped', decline: 'declined', close: 'closed', ask: 'asked', wait: 'waiting' }[r.decision];
let comment = r.comment.trim();
let closeIt = Boolean(r.close);

if (r.decision === 'build') {
  const bad = changed.filter((p) => !ALLOWED(p));
  const src = readFileSync('src/index.js', 'utf8');
  const problems = [];
  if (bad.length) problems.push(`changed files outside src/, contract/api.md, README.md: ${bad.join(', ')}`);
  if (/PROD_ADMIN_TOKEN|sched_prod_admin_/.test(src)) problems.push('the code names the production admin token');
  if (/method\s*:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/i.test(src)) problems.push('the code writes upstream');
  try { sh('node', ['--check', 'src/index.js']); } catch { problems.push('src/index.js does not parse'); }
  if (!r.verify?.path?.startsWith('/')) problems.push('no live check path');

  if (problems.length) {
    console.log('refused:', problems.join('; '));
    discard();
    verb = 'waiting';
    closeIt = false;
    comment += `\n\nThe runner held this change back and nothing was deployed: ${problems.join('; ')}.`;
    await ping(`#${n} held`, `The runner refused the change for #${n}: ${problems.join('; ')}`);
  } else {
    if (changed.length) {
      sh('git', ['config', 'user.name', 'sched-prod agent']);
      sh('git', ['config', 'user.email', 'agent@users.noreply.github.com']);
      sh('git', ['add', '--', ...changed]);
      sh('git', ['commit', '-q', '-m', `#${n}: ${r.summary}`.slice(0, 200)]);
      const remote = `https://x-access-token:${env('GITHUB_TOKEN')}@github.com/${env('GITHUB_REPOSITORY')}.git`;
      for (let i = 0; ; i++) {
        try { sh('git', ['push', '-q', remote, 'HEAD:main']); break; } catch (e) {
          if (i >= 2) throw new Error('push failed');
          sh('git', ['pull', '-q', '--rebase', remote, 'main']);
        }
      }
      console.log('pushed');
    }
    sh('npx', ['wrangler', 'deploy', '--env', 'production'], { stdio: ['ignore', 'inherit', 'inherit'] });
    // 3. The live check: the change must answer on the live address.
    const url = LIVE + r.verify.path;
    for (let i = 0; i < 6 && !live; i++) {
      await new Promise((ok) => setTimeout(ok, 4000));
      try {
        const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
        const body = await res.text();
        live = res.ok && (!r.verify.expect || body.includes(r.verify.expect));
        console.log(`live check ${i + 1}: ${res.status} ${live ? 'ok' : 'not yet'}`);
      } catch (e) { console.log(`live check ${i + 1}: ${e}`); }
    }
    if (live) {
      comment += `\n\nLive: ${url}`;
    } else {
      verb = 'waiting';
      closeIt = false;
      comment += `\n\nDeployed, but ${url} does not answer as expected yet. The agent keeps this open.`;
      await ping(`#${n} not live`, `The change for #${n} was deployed but the live check failed: ${url}`);
    }
  }
} else if (changed.length) {
  discard();
}

// 4. Tracker writes.
if (r.record) {
  const out = await tracker('PUT', `/records/${encodeURIComponent(r.record.id)}`, { text: r.record.text });
  console.log(`record ${r.record.id} version ${out.version ?? '?'}`);
}
const accepted = r.record && /status:\s*accepted/.test(r.record.text);
if (r.decision === 'ask') {
  await tracker('POST', `/issues/${n}/labels`, { label: 'needs-human' });
}
if (accepted) {
  comment += `\n\nRecord ${r.record.id} is now accepted. Owner: please sign it on your round page.`;
}
await tracker('POST', `/issues/${n}/comments`, { body: comment });
if (closeIt) await tracker('POST', `/issues/${n}/close`);
const line = `#${n} · ${verb} · live: ${live ? '✓' : '✗'} · open risks: ${risks.length ? risks.join(', ') : 'none'}`;
await tracker('POST', '/shiplog', { line });
console.log(`ship line: ${line}`);

// 5. Tell the owner when something waits on them.
if (r.decision === 'ask') {
  await ping(`#${n} needs your answer`, `Issue #${n} has a question with numbered options. Answer in the issue with /answer <n> on your round page.`);
}
if (accepted) {
  await ping(`#${n} record to sign`, `Record ${r.record.id} for #${n} is accepted. Please sign it on your round page.`);
}
