import { appendFileSync, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.DEBUG_PORT || 8765);
const host = '127.0.0.1';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};
const allowedProxyHosts = new Set(['api.moonshot.cn']);
const proxyHeaders = new Set(['authorization', 'content-type', 'accept']);
const logsDir = join(root, 'logs');

function readBody(req, maxBytes = 25 * 1024 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        rejectBody(new Error('Request body exceeds 25 MB'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', rejectBody);
  });
}

async function proxyExternalRequest(req, res, requestUrl) {
  let target;
  try { target = new URL(requestUrl.searchParams.get('url') || ''); } catch (_) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Invalid proxy target' }));
    return;
  }
  if (target.protocol !== 'https:' || !allowedProxyHosts.has(target.hostname)) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: `Proxy target is not allowed: ${target.hostname || 'unknown'}` }));
    return;
  }

  try {
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (proxyHeaders.has(name) && typeof value === 'string') headers[name] = value;
    }
    const upstream = await fetch(target, { method: req.method, headers, body });
    const responseBody = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-YKT-Proxy-Target': target.hostname,
    });
    res.end(responseBody);
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'AI proxy request failed', detail: error.message }));
  }
}

function redactLogText(value) {
  return String(value)
    .replace(/data:(image|video)\/[^;,]+;base64,[A-Za-z0-9+/=_-]+/gi, '[REDACTED_MEDIA_BASE64]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-[REDACTED]');
}

async function storeBrowserLogs(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' });
    res.end();
    return;
  }
  try {
    const body = await readBody(req, 2 * 1024 * 1024);
    const parsed = JSON.parse(body.toString('utf8'));
    const entries = Array.isArray(parsed) ? parsed.slice(0, 500) : [parsed];
    mkdirSync(logsDir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const lines = entries
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => redactLogText(JSON.stringify({ ...entry, receivedAt: new Date().toISOString() })))
      .join('\n');
    if (lines) appendFileSync(join(logsDir, `debug-${day}.ndjson`), `${lines}\n`, 'utf8');
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'Invalid debug log batch', detail: error.message }));
  }
}

function resolveFile(pathname) {
  if (pathname === '/') return join(root, 'debug/index.html');
  if (pathname.startsWith('/lesson/fullscreen/v3/')) return join(root, 'debug/student.html');
  const relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '');
  let candidate = resolve(root, relative);
  if (!candidate.startsWith(`${root}/`) && candidate !== root) return null;
  if (existsSync(candidate) && statSync(candidate).isDirectory()) candidate = join(candidate, 'index.html');
  return candidate;
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || host}`);
  const pathname = requestUrl.pathname;
  if (pathname === '/__ykt_logs__') {
    await storeBrowserLogs(req, res);
    return;
  }
  if (pathname === '/__ykt_proxy__') {
    await proxyExternalRequest(req, res, requestUrl);
    return;
  }
  const file = resolveFile(pathname);
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(file).pipe(res);
});

server.listen(port, host, () => {
  console.log(`YKT Test Lab: http://${host}:${port}/debug/`);
  console.log('Business API stays local; Kimi API is enabled through the api.moonshot.cn allowlisted proxy.');
});
