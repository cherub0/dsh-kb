/**
 * Host half of the knowledge-base bundle.
 *
 * Owns the local retrieval service lifecycle (probe the port, spawn Python only
 * when nothing listens, kill the child on unload) and exposes the knowledge base
 * to the agent as three tools: kb_search, kb_ask and kb_rebuild.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createConnection } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = 8765;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_PYTHON = path.join(HERE, '..', 'python');

/** True when something already accepts TCP connections on the port. */
function isPortOpen(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const done = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** First existing path wins; falls back to whatever `python` resolves to. */
function resolvePython(explicit) {
  const home = os.homedir();
  const candidates = [
    explicit,
    path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe'),
    path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
    'python3',
    'python',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === 'python' || candidate === 'python3') return candidate;
    if (existsSync(candidate)) return candidate;
  }
  return 'python';
}

/** Copy the bundled Python service into the knowledge-base folder on first run. */
function ensureKbDir(kbDir, logger) {
  try {
    mkdirSync(kbDir, { recursive: true });
  } catch (err) {
    logger?.warn?.(`[dsh-kb] cannot create ${kbDir}: ${err.message}`);
    return;
  }
  if (!existsSync(BUNDLED_PYTHON)) return;
  for (const name of readdirSync(BUNDLED_PYTHON)) {
    if (!name.endsWith('.py')) continue;
    const dest = path.join(kbDir, name);
    if (existsSync(dest)) continue;
    try {
      copyFileSync(path.join(BUNDLED_PYTHON, name), dest);
      logger?.info?.(`[dsh-kb] installed ${name} into ${kbDir}`);
    } catch (err) {
      logger?.warn?.(`[dsh-kb] cannot copy ${name}: ${err.message}`);
    }
  }
}

export const inject = ['tools'];

export function apply(ctx, config = {}) {
  const port = Number(config.port ?? DEFAULT_PORT);
  const home = os.homedir();
  const kbDir = config.kbDir ?? process.env.DSH_KB_DIR ?? path.join(home, '.dsh', 'kb');
  const script = config.script ?? path.join(kbDir, 'server.py');
  const base = `http://127.0.0.1:${port}`;
  let child;
  let disposed = false;

  const start = async () => {
    if (await isPortOpen(port)) {
      ctx.logger?.info?.(`[dsh-kb] service already on 127.0.0.1:${port}, leaving it alone`);
      return;
    }
    if (disposed) return;
    ensureKbDir(kbDir, ctx.logger);
    if (!existsSync(script)) {
      ctx.logger?.warn?.(`[dsh-kb] server script missing: ${script}`);
      return;
    }
    const python = resolvePython(config.python);
    try {
      child = spawn(python, [script], {
        cwd: kbDir,
        env: { ...process.env, DSH_KB_DIR: kbDir },
        windowsHide: true,
        stdio: 'ignore',
        detached: false,
      });
      child.once('exit', (code) => {
        if (!disposed) ctx.logger?.warn?.(`[dsh-kb] service exited (code ${code})`);
        child = undefined;
      });
      child.once('error', (err) => {
        ctx.logger?.warn?.(`[dsh-kb] failed to start service: ${err.message}`);
        child = undefined;
      });
      ctx.logger?.info?.(`[dsh-kb] starting service: ${python} ${script}`);
    } catch (err) {
      ctx.logger?.warn?.(`[dsh-kb] spawn failed: ${err.message}`);
    }
  };

  ctx.effect(() => {
    void start();
    return () => {
      disposed = true;
      if (!child) return;
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      child = undefined;
    };
  });

  const TOOL_OUTPUT = {
    schema: { type: 'object', properties: { text: { type: 'string' } } },
    render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
  };

  const request = async (route, { method = 'GET', body, timeoutMs = 120000 } = {}) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(base + route, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } finally {
      clearTimeout(timer);
    }
  };

  ctx.effect(() => ctx.tools.register({
    name: 'kb_search',
    description:
      'Search the user\'s local knowledge base — their WeChat favourites, their own notes and imported '
      + 'documents — and return matching passages with title, date and source kind. '
      + 'Prefer this over guessing when the question is about something the user saved, read or wrote.',
    parameters: {
      query: { type: 'string', required: true, description: 'What to look for, in natural language.' },
      k: { type: 'integer', description: 'Passages to return, 1-15. Defaults to 6.' },
      kind: {
        type: 'string',
        description: 'Restrict sources: "fav" (WeChat favourites), "chat" (own notes), "import" (imported documents). Comma-separate for several.',
      },
    },
    timeoutMs: 120000,
    output: TOOL_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args) {
      const k = Math.max(1, Math.min(15, Number(args?.k) || 6));
      const kind = args?.kind ? String(args.kind) : '';
      const data = await request(
        `/search?q=${encodeURIComponent(String(args?.query ?? ''))}&k=${k}`
        + (kind ? `&kind=${encodeURIComponent(kind)}` : ''),
      );
      const hits = data.hits || [];
      if (!hits.length) return '知识库里没有匹配的内容。';
      const lines = hits.map((hit, i) => {
        const snippet = String(hit.text || '').replace(/\s+/g, ' ').slice(0, 260);
        return `${i + 1}. 《${hit.title}》 (${hit.date} · ${hit.kind} · ${hit.score})\n   ${snippet}\n   路径: ${hit.path}`;
      });
      return { text: `${hits.length} 条命中，${data.ms} ms：\n\n${lines.join('\n\n')}` };
    },
  }), 'dsh-kb: kb_search');

  ctx.effect(() => ctx.tools.register({
    name: 'kb_ask',
    description:
      'Ask the user\'s knowledge base a question and get a synthesised answer with citations (资料N). '
      + 'Retrieves the most relevant passages and answers from them; slower than kb_search (10-40s). '
      + 'Use it when you need an explanation rather than raw passages.',
    parameters: {
      question: { type: 'string', required: true, description: 'The question to answer from the knowledge base.' },
      kind: { type: 'string', description: 'Restrict sources: "fav", "chat" or "import".' },
    },
    timeoutMs: 300000,
    output: TOOL_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args) {
      const data = await request('/ask', {
        method: 'POST',
        body: { q: String(args?.question ?? ''), kind: args?.kind ? String(args.kind) : undefined },
        timeoutMs: 300000,
      });
      const sources = (data.sources || [])
        .map((s) => `（资料${s.n}）${s.title} · ${s.date} · ${s.path}`)
        .join('\n');
      return { text: `${data.answer}\n\n---\n来源 ${data.sources?.length ?? 0} 条，用时 ${data.ms} ms：\n${sources}` };
    },
  }), 'dsh-kb: kb_ask');

  ctx.effect(() => ctx.tools.register({
    name: 'kb_rebuild',
    description:
      'Import everything in the knowledge-base inbox (kb/inbox: pdf, docx, txt, md) and rebuild the index, '
      + 're-embedding only changed passages. Use after the user drops files into that folder.',
    parameters: {},
    timeoutMs: 1800000,
    output: TOOL_OUTPUT,
    async execute() {
      const data = await request('/import', { method: 'POST', body: {}, timeoutMs: 1800000 });
      return { text: `索引重建完成：${data.chunks} 个段落，用时 ${Math.round((data.ms || 0) / 1000)} 秒。\n\n${data.log || ''}` };
    },
  }), 'dsh-kb: kb_rebuild');
}
