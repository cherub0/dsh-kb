"""Rebuild index.db from the notes on disk (keeps fetched full text)."""
import glob, os, re, sqlite3, datetime, json

KB = r'C:\Users\范海华\.dsh\im\kb'
IDX = os.path.join(KB, 'index.db')

FM = re.compile(r'^---\s*\n(.*?)\n---\s*\n(.*)$', re.S)


def parse(path):
    text = open(path, encoding='utf-8').read()
    m = FM.match(text)
    if not m:
        return None
    meta_raw, body = m.group(1), m.group(2)
    meta = {}
    for line in meta_raw.splitlines():
        if ': ' in line:
            k, v = line.split(': ', 1)
            meta[k.strip()] = v.strip().strip('"')
    body = body.strip()
    body = re.sub(r'^#\s.*$', '', body, count=1, flags=re.M).strip()
    return {
        'title': meta.get('title', ''),
        'date': meta.get('date', ''),
        'kind': meta.get('kind', ''),
        'type': meta.get('type', ''),
        'url': meta.get('url', ''),
        'body': body,
        'rel': os.path.relpath(path, KB),
    }


def main():
    rows = []
    for p in sorted(glob.glob(os.path.join(KB, 'notes', '**', '*.md'), recursive=True)):
        d = parse(p)
        if d:
            rows.append(d)

    if os.path.exists(IDX):
        os.remove(IDX)
    con = sqlite3.connect(IDX)
    con.execute("CREATE VIRTUAL TABLE notes USING fts5(title, body, path UNINDEXED, "
                "date UNINDEXED, kind UNINDEXED, type UNINDEXED, url UNINDEXED, tokenize='trigram')")
    con.execute("CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT)")
    for r in rows:
        con.execute("INSERT INTO notes(title, body, path, date, kind, type, url) VALUES (?,?,?,?,?,?,?)",
                    (r['title'], r['body'][:40000], r['rel'], r['date'], r['kind'], r['type'], r['url']))
    con.execute("INSERT INTO meta VALUES ('built_at', ?)", (datetime.datetime.now().isoformat(),))
    con.execute("INSERT INTO meta VALUES ('count', ?)", (str(len(rows)),))
    con.commit()
    con.execute("INSERT INTO notes(notes) VALUES ('optimize')")
    con.commit()

    full = sum(1 for r in rows if '## 正文' in r['body'])
    print(f'indexed {len(rows)} notes | with fulltext: {full} | db={os.path.getsize(IDX)} bytes')


if __name__ == '__main__':
    main()
