// Smoke test only: a made-up issue and context in .work/, so Codex can run before the round with no tracker.
import { readFileSync } from 'node:fs';
import { save } from '../lib.mjs';

const issue = JSON.parse(readFileSync('agent/smoke/issue.json', 'utf8'));
save('.work/issue.json', issue);
save('.work/issues.json', { now: issue.openedAt, lastIssueBy: issue.openedAt, issues: [issue] });
save('.work/records.json', { records: [] });
save('.work/shiplog.txt', '');
save('.work/reason.txt', 'new');
save('.work/feed.json', { status: 200, body: JSON.stringify({ incidents: [
  { id: 'INC-1001', service: 'calendar-sync', summary: 'Sync queue stalled', status: 'open', openedAt: '2026-11-11T02:43:00.000Z' },
] }) });
save('.work/live.json', { status: 500, body: 'smoke test: no feed yet' });
console.log('smoke context ready');
