// sched-prod API: the incidents the status page and the board read. Contract: contract/api.md.

const json = (body, status = 200) => Response.json(body, { status });

async function feed(env) {
  const res = await fetch(env.FEED_URL);
  if (!res.ok) throw new Error(`feed answered ${res.status}`);
  const { incidents } = await res.json();
  return incidents;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/incidents') {
      const status = url.searchParams.get('status');
      const since = url.searchParams.get('since');
      const incidents = await feed(env);
      const sinceTime = since === null ? null : Date.parse(since);
      return json({ incidents: incidents.filter((incident) =>
        (status === null || incident.status === status) &&
        (since === null || Date.parse(incident.openedAt) > sinceTime)) });
    }
    const match = url.pathname.match(/^\/incidents\/([^/]+)$/);
    if (request.method === 'GET' && match) {
      let id;
      try {
        id = decodeURIComponent(match[1]);
      } catch {
        return json({ error: 'not found' }, 404);
      }
      const incident = (await feed(env)).find((item) => item.id === id);
      if (incident) return json({ incident });
    }
    return json({ error: 'not found' }, 404);
  },
};
