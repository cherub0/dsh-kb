"""Local knowledge-base service: chunk retrieval (MMR + filters) and RAG answers.

    GET  /search?q=...&k=5&kind=fav,chat      -> chunk hits
    POST /ask   {"q","history","kind"}        -> {"answer","sources"}
    POST /rebuild                              -> reindex notes into chunks
    POST /import                               -> import kb/inbox then reindex
    GET  /stats, /health
"""
import json, os, re, subprocess, sys, threading, time, yaml
os.environ.setdefault('HF_ENDPOINT', 'https://hf-mirror.com')
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')

import numpy as np
import requests
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from sentence_transformers import SentenceTransformer

KB = os.environ.get('DSH_KB_DIR') or os.path.dirname(os.path.abspath(__file__))
MODEL = 'BAAI/bge-small-zh-v1.5'
PORT = 8765
DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
CHAT_MODEL = os.environ.get('KB_CHAT_MODEL', 'deepseek-reasoner')
TOP_CHUNKS = 16
MAX_CTX = 1600
PER_NOTE = 2
MMR_LAMBDA = 0.72
POOL = 90

SYSTEM = (
    '你是用户的私人知识库助手，同时也是资深工程师。下面是从他收藏的文章、自己的笔记和导入的文档里检索到的资料。\n\n'
    '回答要求：\n'
    '1. 结论先行：两句话说清「是什么、为什么」，不复述问题、不寒暄。\n'
    '2. 然后分层深入，按这条线走（按问题性质取舍，不必全占）：\n'
    '   - **机制**：底层怎么运作，因果链一步步拆开，涉及的内核路径 / 函数名 / 数据结构要写出来。\n'
    '   - **关键代码**：贴出真正起作用的片段或调用链，不要只描述。\n'
    '   - **实操**：可直接执行的命令、配置、参数，标明含义和取值范围。\n'
    '   - **边界与坑**：什么情况下不成立、常见误解、踩过的坑。\n'
    '   - **延伸**：和相邻机制的对比，或资料里提到的、值得继续看的方向。\n'
    '3. 篇幅服从内容：技术问题 800–1500 字是正常的，把因果讲透，不要为了短而省略推理。\n'
    '4. 引用资料在句末标（资料N）；多份资料讲同一件事要综合，不要逐条罗列。\n'
    '5. 资料没覆盖的部分，用通用知识补，但标「（资料外）」；不确定就明说不确定。\n'
    '6. 不要用「综上所述」「希望对你有帮助」；不要凑字数，每段都要有信息增量。\n'
    '7. 中文回答；术语、函数名、命令保留原文。'
)


def load_key():
    path = os.path.join(os.path.expanduser('~'), '.dsh', '.credentials.yaml')
    try:
        d = yaml.safe_load(open(path, encoding='utf-8'))
        return d['refs']['DEEPSEEK_API_KEY']
    except Exception:
        return os.environ.get('DEEPSEEK_API_KEY', '')


def load_index():
    emb_p = os.path.join(KB, 'chunk_emb.npy')
    meta_p = os.path.join(KB, 'chunk_meta.json')
    if os.path.exists(emb_p) and os.path.exists(meta_p):
        with open(meta_p, encoding='utf-8') as handle:
            loaded = json.load(handle)
        return np.load(emb_p), loaded
    # no index yet: serve an empty knowledge base until the first rebuild
    return np.zeros((0, 512), dtype='float32'), {'model': MODEL, 'count': 0, 'built_at': '-', 'chunks': []}


print('loading chunk index...', flush=True)
emb, meta = load_index()
chunks = meta['chunks']
print(f'{emb.shape[0]} chunks, {emb.shape[1]} dims', flush=True)

print('loading model...', flush=True)
model = SentenceTransformer(MODEL, device='cpu')
API_KEY = load_key()
print('deepseek key:', 'yes' if API_KEY else 'NO', flush=True)

_reload_lock = threading.Lock()


def reload_index():
    global emb, meta, chunks
    with _reload_lock:
        e, m = load_index()
        emb, meta, chunks = e, m, m['chunks']
        print(f'reloaded {len(chunks)} chunks', flush=True)


def query_terms(q):
    terms = set()
    for w in re.findall(r'[A-Za-z][A-Za-z0-9_\-\.]{1,}', q.lower()):
        terms.add(w)
    cjk = re.sub(r'[^\u4e00-\u9fff]', '', q)
    for i in range(len(cjk) - 1):
        terms.add(cjk[i:i + 2])
    return terms


def search(q, k=TOP_CHUNKS, kinds=None):
    """Vector + lexical scoring, MMR diversity, at most PER_NOTE chunks per note."""
    if len(chunks) == 0:
        return []
    vec = model.encode([q], normalize_embeddings=True)[0]
    scores = emb @ vec
    terms = query_terms(q)
    if terms:
        for i, c in enumerate(chunks):
            hit = sum(1 for t in terms if t in c['text'].lower())
            if hit:
                scores[i] += min(0.12, 0.02 * hit)

    allowed = [i for i, c in enumerate(chunks) if not kinds or c.get('kind') in kinds]
    if not allowed:
        return []
    allowed.sort(key=lambda i: -scores[i])
    pool = allowed[:POOL]

    picked, per_note, picked_vecs = [], {}, []
    lam = MMR_LAMBDA
    while len(picked) < k and pool:
        best, best_val = None, -1e9
        for i in pool:
            c = chunks[i]
            if per_note.get(c['path'], 0) >= PER_NOTE:
                continue
            red = 0.0
            if picked_vecs:
                red = float(np.max(emb[i] @ np.stack(picked_vecs).T))
            val = lam * float(scores[i]) - (1 - lam) * red
            if val > best_val:
                best, best_val = i, val
        if best is None:
            break
        c = chunks[best]
        per_note[c['path']] = per_note.get(c['path'], 0) + 1
        picked.append({**c, 'score': round(float(scores[best]), 4)})
        picked_vecs.append(emb[best])
        pool = [i for i in pool if i != best]
    return picked


def ask(q, history, kinds=None):
    hits = search(q, TOP_CHUNKS, kinds)

    groups, order = {}, []
    for h in hits:
        p = h['path']
        if p not in groups:
            groups[p] = {'title': h['title'], 'date': h['date'], 'url': h['url'],
                         'kind': h['kind'], 'score': h['score'], 'texts': []}
            order.append(p)
        groups[p]['texts'].append(h['text'].strip()[:MAX_CTX])

    blocks = []
    for n, p in enumerate(order, 1):
        g = groups[p]
        body = '\n\n'.join(g['texts'])[:MAX_CTX * 2]
        blocks.append(f"【资料{n}】《{g['title']}》（{g['date']}，{g['kind']}）\n{body}")

    messages = [
        {'role': 'system', 'content': SYSTEM},
        {'role': 'user', 'content': '检索到的资料：\n\n' + '\n\n'.join(blocks)},
        {'role': 'assistant', 'content': '资料已读完，可以提问。'},
    ]
    for m in (history or [])[-6:]:
        if m.get('role') in ('user', 'assistant') and m.get('content'):
            messages.append({'role': m['role'], 'content': str(m['content'])[:2000]})
    messages.append({'role': 'user', 'content': q})

    r = requests.post(DEEPSEEK_URL, timeout=300,
                      headers={'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json'},
                      json={'model': CHAT_MODEL, 'messages': messages,
                            'max_tokens': 6000, 'temperature': 0.35})
    if r.status_code != 200:
        raise RuntimeError(f'LLM {r.status_code}: {r.text[:200]}')
    answer = r.json()['choices'][0]['message']['content']

    sources = []
    for i, p in enumerate(order, 1):
        g = groups[p]
        snippet = ' '.join(g['texts'][0].split())
        sources.append({'n': i, 'title': g['title'], 'date': g['date'], 'kind': g['kind'],
                        'path': p, 'url': g['url'], 'score': g['score'],
                        'snippet': snippet[:800], 'chars': len(snippet)})
    return answer, sources


def run_script(name):
    py = sys.executable
    out = subprocess.run([py, os.path.join(KB, name)], capture_output=True, text=True,
                         encoding='utf-8', errors='replace', timeout=1800)
    return (out.stdout or '') + (out.stderr or '')


class H(BaseHTTPRequestHandler):
    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        if u.path == '/health':
            return self._json({'ok': True})
        if u.path == '/stats':
            kinds = {}
            for c in chunks:
                kinds[c.get('kind') or 'unknown'] = kinds.get(c.get('kind') or 'unknown', 0) + 1
            notes = len({c['path'] for c in chunks})
            return self._json({'chunks': meta['count'], 'notes': notes, 'dim': int(emb.shape[1]),
                               'model': meta['model'], 'built_at': meta['built_at'],
                               'kinds': kinds, 'chat': bool(API_KEY), 'chatModel': CHAT_MODEL})
        if u.path == '/search':
            q = (qs.get('q') or [''])[0].strip()
            if not q:
                return self._json({'error': 'missing q'}, 400)
            k = int((qs.get('k') or ['6'])[0])
            kinds = [x for x in ((qs.get('kind') or [''])[0]).split(',') if x] or None
            t0 = time.time()
            hits = search(q, max(1, min(k, 30)), kinds)
            return self._json({'query': q, 'ms': int((time.time() - t0) * 1000), 'hits': hits})
        return self._json({'error': 'not found'}, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            n = int(self.headers.get('Content-Length') or 0)
            payload = json.loads(self.rfile.read(n) or b'{}')
        except Exception:
            payload = {}
        try:
            if path == '/ask':
                q = (payload.get('q') or '').strip()
                if not q:
                    return self._json({'error': 'missing q'}, 400)
                kinds = payload.get('kind') or None
                t0 = time.time()
                answer, sources = ask(q, payload.get('history') or [], kinds)
                return self._json({'answer': answer, 'sources': sources,
                                   'ms': int((time.time() - t0) * 1000)})
            if path == '/rebuild':
                t0 = time.time()
                out = run_script('chunk_build.py')
                reload_index()
                return self._json({'ok': True, 'ms': int((time.time() - t0) * 1000),
                                   'chunks': meta['count'], 'log': out[-1500:]})
            if path == '/import':
                t0 = time.time()
                imp = run_script('import_inbox.py')
                out = run_script('chunk_build.py')
                reload_index()
                return self._json({'ok': True, 'ms': int((time.time() - t0) * 1000),
                                   'chunks': meta['count'], 'log': (imp + out)[-2500:]})
            return self._json({'error': 'not found'}, 404)
        except Exception as e:
            return self._json({'error': str(e)[:400]}, 500)

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
