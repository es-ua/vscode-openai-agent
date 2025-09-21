import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';

let nextId = 1;
const pending = new Map();

function send(result, id) {
  const msg = JSON.stringify({ jsonrpc: '2.0', result, id });
  process.stdout.write(msg + '\n');
}

function sendError(error, id) {
  const msg = JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: String(error) }, id });
  process.stdout.write(msg + '\n');
}

function resolvePath(p) {
  const root = process.env.WORKSPACE_DIR || process.cwd();
  if (!p) return root;
  if (path.isAbsolute(p)) return p;
  return path.join(root, p);
}

async function read_file(params) {
  const full = resolvePath(params.path);
  const maxBytes = params.maxBytes ?? 200000;
  const data = await fs.promises.readFile(full);
  const buf = data.slice(0, maxBytes);
  return { path: full, content: buf.toString('utf8'), truncated: data.length > buf.length };
}

async function search_workspace(params) {
  const root = resolvePath(params.root || '.');
  const patterns = params.includeGlobs?.length ? params.includeGlobs : ['**/*.*'];
  const ignore = params.excludeGlobs || ['**/node_modules/**', '**/.git/**', '**/out/**', '**/dist/**'];
  const files = await fg(patterns, { cwd: root, ignore, absolute: true, dot: false });
  const results = [];
  const query = params.query || '';
  const maxMatches = params.maxMatches ?? 200;

  for (const file of files) {
    try {
      const stat = await fs.promises.stat(file);
      if (stat.size > (params.maxFileBytes ?? 500000)) continue;
      const text = await fs.promises.readFile(file, 'utf8');
      if (!query || text.includes(query)) {
        results.push({ file, size: stat.size });
        if (results.length >= maxMatches) break;
      }
    } catch {}
  }
  return { root, query, results };
}

const handlers = { read_file, search_workspace };

process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      const { id, method, params } = msg;
      const fn = handlers[method];
      if (!fn) {
        sendError(`Unknown method: ${method}`, id);
        continue;
      }
      Promise.resolve(fn(params || {}))
        .then(res => send(res, id))
        .catch(err => sendError(err?.message || String(err), id));
    } catch (e) {
      // ignore malformed lines
    }
  }
});
