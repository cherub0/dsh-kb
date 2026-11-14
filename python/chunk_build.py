"""Chunk every KB note and embed the chunks, reusing cached vectors per chunk text."""
import glob, hashlib, json, os, re, time
os.environ.setdefault('HF_ENDPOINT', 'https://hf-mirror.com')
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')

import numpy as np
from sentence_transformers import SentenceTransformer

KB = os.environ.get('DSH_KB_DIR') or os.path.dirname(os.path.abspath(__file__))
MODEL = 'BAAI/bge-small-zh-v1.5'
CHUNK = 700
OVERLAP = 120
CACHE = os.path.join(KB, 'chunk_embed_cache.npz')

FM = re.compile(r'^---\s*\n(.*?)\n---\s*\n(.*)$', re.S)


def parse(path):
    text = open(path, encoding='utf-8').read()
    m = FM.match(text)
    if not m:
        return None
    meta, body = m.group(1), m.group(2)
    d = {}
    for line in meta.splitlines():
        if ': ' in line:
            k, v = line.split(': ', 1)
            d[k.strip()] = v.strip().strip('"')
    body = re.sub(r'^#\s.*$', '', body, count=1, flags=re.M).strip()
    return d, body


def split(text):
    paras = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
    out, buf, size = [], [], 0
    for p in paras:
        if size + len(p) > CHUNK and buf:
            out.append('\n\n'.join(buf))
            tail = buf[-1][-OVERLAP:] if buf else ''
            buf, size = ([tail] if tail else []), len(tail)
        buf.append(p)
        size += len(p) + 2
    if buf:
        out.append('\n\n'.join(buf))
    final = []
    for c in out:
        while len(c) > CHUNK * 2:
            final.append(c[:CHUNK * 2])
            c = c[CHUNK * 2 - OVERLAP:]
        final.append(c)
    return [c for c in final if len(c.strip()) > 40]


def h11(text):
    return hashlib.sha1(text.encode('utf-8')).hexdigest()[:16]


def load_cache():
    if not os.path.exists(CACHE):
        return {}
    try:
        z = np.load(CACHE, allow_pickle=False)
        return {k: z[k] for k in z.files}
    except Exception:
        return {}


def main():
    files = sorted(glob.glob(os.path.join(KB, 'notes', '**', '*.md'), recursive=True))
    chunks = []
    for p in files:
        parsed = parse(p)
        if not parsed:
            continue
        meta, body = parsed
        title = meta.get('title', os.path.basename(p))
        for i, c in enumerate(split(body)):
            chunks.append({
                'path': os.path.relpath(p, KB), 'title': title,
                'date': meta.get('date', ''), 'kind': meta.get('kind', ''),
                'url': meta.get('url', ''), 'idx': i, 'text': c,
                'h': h11(c),
            })
    print('notes:', len(files), '-> chunks:', len(chunks), flush=True)

    cache = load_cache()
    todo = [c for c in chunks if c['h'] not in cache]
    print('cached:', len(chunks) - len(todo), 'to embed:', len(todo), flush=True)

    if todo:
        model = SentenceTransformer(MODEL, device='cpu')
        t0 = time.time()
        vecs = model.encode([f"{c['title']}\n{c['text']}" for c in todo],
                            batch_size=32, show_progress_bar=False, normalize_embeddings=True)
        print('encoded %d in %.1fs' % (len(todo), time.time() - t0), flush=True)
        for c, v in zip(todo, vecs):
            cache[c['h']] = v.astype('float32')

    emb = np.stack([cache[c['h']] for c in chunks]).astype('float32')
    np.save(os.path.join(KB, 'chunk_emb.npy'), emb)

    # keep only the hashes still referenced
    live = {c['h'] for c in chunks}
    np.savez_compressed(CACHE, **{k: v for k, v in cache.items() if k in live})

    with open(os.path.join(KB, 'chunk_meta.json'), 'w', encoding='utf-8') as f:
        json.dump({'model': MODEL, 'count': len(chunks),
                   'built_at': time.strftime('%Y-%m-%d %H:%M:%S'),
                   'chunks': [{k: v for k, v in c.items() if k != 'h'} for c in chunks]},
                  f, ensure_ascii=False)
    print('saved %d chunks x %d dims' % emb.shape, flush=True)


if __name__ == '__main__':
    main()
