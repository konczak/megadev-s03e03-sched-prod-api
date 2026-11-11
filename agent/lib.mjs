// Shared helpers for the runner steps. Tokens come from the environment only; nothing here prints them.
import { writeFileSync, mkdirSync } from 'node:fs';

export function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export async function tracker(method, path, body) {
  const base = env('TRACKER_URL').replace(/\/+$/, '');
  const res = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${env('TRACKER_TOKEN')}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  console.log(`tracker ${method} ${path} -> ${res.status}`);
  if (!res.ok) throw new Error(`tracker ${method} ${path} answered ${res.status}: ${data.message ?? text.slice(0, 200)}`);
  return data;
}

export async function ping(title, message) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) { console.log('ntfy: no topic, skipped'); return; }
  const headers = { Title: title, Tags: 'robot' };
  if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
  if (process.env.ROUND_PAGE) headers.Click = process.env.ROUND_PAGE;
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${process.env.NTFY_BASE ?? 'https://ntfy.sh'}/${encodeURIComponent(topic)}`, { method: 'POST', headers, body: message });
    console.log(`ntfy try ${i + 1} -> ${res.status}`);
    if (res.ok) return;
    await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
  }
}

export function save(path, data) {
  mkdirSync('.work', { recursive: true });
  writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

export function issueNumber(raw) {
  if (!/^\d{1,6}$/.test(String(raw ?? ''))) throw new Error('issue must be a number');
  return Number(raw);
}
