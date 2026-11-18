import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PRESETS_DIR = path.join(ROOT_DIR, 'presets');
const EXPORTS_DIR = path.join(ROOT_DIR, 'exports');
const SHADERS_DIR = path.join(ROOT_DIR, 'src', 'shaders');
const PORT = Number(process.env.PORT || 8000);
const HOST = '127.0.0.1';

const watchClients = new Set();
let watchTimer = null;
try {
  fsSync.watch(SHADERS_DIR, (_eventType, filename) => {
    if (!filename || !filename.endsWith('.js')) return;
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      const payload = `data: ${JSON.stringify({ file: filename, ts: Date.now() })}\n\n`;
      for (const client of watchClients) {
        client.write(payload);
      }
    }, 100);
  });
} catch {
  // Ignore if directory watch is unavailable
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'untitled';
}

async function resolveUniqueFilename(dir, filename) {
  const safe = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '-');
  const dot = safe.indexOf('.');
  const stem = dot >= 0 ? safe.slice(0, dot) : safe;
  const ext = dot >= 0 ? safe.slice(dot) : '';

  let candidate = safe;
  let n = 2;
  while (true) {
    try {
      await fs.access(path.join(dir, candidate));
      candidate = `${stem}-${n}${ext}`;
      n += 1;
    } catch {
      return candidate;
    }
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readJsonBody(req, maxBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function listDiskPresets() {
  await fs.mkdir(PRESETS_DIR, { recursive: true });
  const entries = await fs.readdir(PRESETS_DIR, { withFileTypes: true });
  const presets = {};

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(PRESETS_DIR, entry.name), 'utf8');
      const parsed = JSON.parse(raw);
      const key = parsed.name || entry.name.replace(/\.preset\.json$|\.json$/i, '');
      presets[key] = { ...parsed, name: key, _file: entry.name };
    } catch {
      // Skip malformed preset files
    }
  }
  return presets;
}

async function handleApi(req, res, urlPath) {
  if (req.method === 'GET' && urlPath === '/api/watch') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    watchClients.add(res);
    req.on('close', () => watchClients.delete(res));
    return;
  }

  if (req.method === 'GET' && urlPath === '/api/presets') {
    const presets = await listDiskPresets();
    return sendJson(res, 200, { ok: true, presets });
  }

  if (req.method === 'POST' && urlPath === '/api/presets') {
    const body = await readJsonBody(req);
    if (!body?.name || !body?.studyId) {
      return sendJson(res, 400, { ok: false, error: 'Missing preset name or studyId' });
    }
    await fs.mkdir(PRESETS_DIR, { recursive: true });
    const slug = slugify(body.name);
    const filename = await resolveUniqueFilename(PRESETS_DIR, `${slug}.preset.json`);
    const record = { ...body, updatedAt: new Date().toISOString() };
    await fs.writeFile(path.join(PRESETS_DIR, filename), JSON.stringify(record, null, 2), 'utf8');
    return sendJson(res, 200, { ok: true, file: `presets/${filename}`, preset: record });
  }

  if (req.method === 'DELETE' && urlPath.startsWith('/api/presets/')) {
    const rawName = decodeURIComponent(urlPath.slice('/api/presets/'.length));
    const slug = slugify(rawName);
    const target = path.join(PRESETS_DIR, `${slug}.preset.json`);
    await fs.rm(target, { force: true });
    return sendJson(res, 200, { ok: true, deleted: `presets/${slug}.preset.json` });
  }

  if (req.method === 'POST' && urlPath === '/api/exports') {
    const body = await readJsonBody(req);
    if (!body?.filename || typeof body?.content !== 'string') {
      return sendJson(res, 400, { ok: false, error: 'Missing filename or content' });
    }
    await fs.mkdir(EXPORTS_DIR, { recursive: true });
    const filename = await resolveUniqueFilename(EXPORTS_DIR, body.filename);
    const target = path.join(EXPORTS_DIR, filename);
    await fs.writeFile(target, body.content, 'utf8');
    return sendJson(res, 200, { ok: true, file: `exports/${filename}` });
  }

  return sendJson(res, 404, { ok: false, error: 'Unknown API route' });
}

async function handleStatic(req, res, urlPath) {
  const relPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const resolved = path.resolve(ROOT_DIR, relPath);
  if (!resolved.startsWith(ROOT_DIR + path.sep) && resolved !== ROOT_DIR) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  try {
    const data = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url.pathname);
    } else {
      await handleStatic(req, res, url.pathname);
    }
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Toyheart Lab running at http://${HOST}:${PORT}`);
  console.log(`Disk storage: presets/ & exports/`);
});
