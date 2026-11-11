// Before Codex runs: put everything it must read into .work/, so Codex needs no network and no token.
// Usage: node agent/fetch-context.mjs <issue> <new|owner>
import { tracker, save, issueNumber, env } from './lib.mjs';

const n = issueNumber(process.argv[2]);
const reason = process.argv[3] === 'owner' ? 'owner' : 'new';

const issue = await tracker('GET', `/issues/${n}`);
const all = await tracker('GET', '/issues');
const records = await tracker('GET', '/records');
const shiplog = await tracker('GET', '/shiplog');

save('.work/issue.json', issue);
save('.work/issues.json', all);
save('.work/records.json', records);
save('.work/shiplog.txt', shiplog.text ?? '');
save('.work/reason.txt', reason);

async function grab(url) {
  try {
    const res = await fetch(url);
    const text = await res.text();
    return { url, status: res.status, body: text.slice(0, 20000) };
  } catch (e) {
    return { url, error: String(e) };
  }
}
save('.work/feed.json', await grab(env('FEED_URL')));
save('.work/live.json', await grab(env('LIVE_URL').replace(/\/+$/, '') + '/incidents'));
console.log(`context ready for #${n} (${reason})`);
