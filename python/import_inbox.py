"""Import documents from kb/inbox into the knowledge base as notes."""
import hashlib, os, re, shutil, sys, time

KB = os.environ.get('DSH_KB_DIR') or os.path.dirname(os.path.abspath(__file__))
INBOX = os.path.join(KB, 'inbox')
DONE = os.path.join(INBOX, 'done')
OUT = os.path.join(KB, 'notes', 'import')
TEXT_EXT = {'.md', '.markdown', '.txt', '.log', '.json', '.csv', '.py', '.c', '.h', '.cpp', '.rs', '.go', '.js', '.ts'}


def slug(name):
    s = re.sub(r'[\\/:*?"<>|\s]+', '-', name).strip('-')
    return s[:80] or 'doc'


def read_pdf(path):
    try:
        from pypdf import PdfReader
    except ImportError:
        try:
            from PyPDF2 import PdfReader
        except ImportError:
            return None, 'pypdf 未安装'
    try:
        r = PdfReader(path)
        pages = []
        for i, p in enumerate(r.pages, 1):
            try:
                t = p.extract_text() or ''
            except Exception:
                t = ''
            if t.strip():
                pages.append(f'[第 {i} 页]\n{t.strip()}')
        return '\n\n'.join(pages), None
    except Exception as e:
        return None, f'PDF 解析失败: {e}'


def read_docx(path):
    try:
        import docx
    except ImportError:
        return None, 'python-docx 未安装'
    try:
        d = docx.Document(path)
        parts = [p.text.strip() for p in d.paragraphs if p.text.strip()]
        for t in d.tables:
            for row in t.rows:
                cells = [c.text.strip() for c in row.cells if c.text.strip()]
                if cells:
                    parts.append(' | '.join(cells))
        return '\n\n'.join(parts), None
    except Exception as e:
        return None, f'DOCX 解析失败: {e}'


def read_any(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == '.pdf':
        return read_pdf(path)
    if ext in ('.docx', '.doc'):
        return read_docx(path)
    if ext in TEXT_EXT or ext == '':
        for enc in ('utf-8', 'utf-8-sig', 'gbk', 'latin-1'):
            try:
                return open(path, encoding=enc).read(), None
            except UnicodeDecodeError:
                continue
        return None, '编码无法识别'
    return None, f'不支持的格式 {ext}'


def main():
    os.makedirs(INBOX, exist_ok=True)
    os.makedirs(DONE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    files = [f for f in sorted(os.listdir(INBOX)) if os.path.isfile(os.path.join(INBOX, f))]
    if not files:
        print('inbox 是空的（把 PDF/Word/txt/md 丢进 kb/inbox/）')
        return
    ok = bad = 0
    for fn in files:
        src = os.path.join(INBOX, fn)
        text, err = read_any(src)
        if err or not text or len(text.strip()) < 20:
            print(f'  跳过 {fn}: {err or "内容太短"}')
            bad += 1
            continue
        stem = os.path.splitext(fn)[0]
        h = hashlib.sha256(text.encode('utf-8', 'ignore')).hexdigest()[:10]
        out = os.path.join(OUT, f'{slug(stem)}-{h}.md')
        title = stem.replace('-', ' ').replace('_', ' ').strip()
        body = text.strip()
        with open(out, 'w', encoding='utf-8') as f:
            f.write('---\n')
            f.write(f'title: "{title[:120]}"\n')
            f.write(f'date: "{time.strftime("%Y-%m-%d")}"\n')
            f.write('kind: import\n')
            f.write('type: document\n')
            f.write(f'source: "{fn}"\n')
            f.write('url: ""\n')
            f.write('---\n\n')
            f.write(f'# {title}\n\n{body}\n')
        shutil.move(src, os.path.join(DONE, fn))
        print(f'  导入 {fn} -> notes/import/{os.path.basename(out)} ({len(body)} 字)')
        ok += 1
    print(f'完成: 成功 {ok} 个，失败 {bad} 个')


if __name__ == '__main__':
    main()
