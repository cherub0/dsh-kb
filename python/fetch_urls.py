"""Fetch WeChat article URLs into the knowledge base as import notes."""
import hashlib, html, os, re, sys, time
import requests

KB = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(KB, 'notes', 'import')

UA = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003133) NetType/WIFI Language/zh_CN',
]
BLOCK = re.compile(r'</(p|div|section|br|li|h[1-6]|tr|pre|blockquote)>', re.I)
PAGE_URL = ''


def to_markdown(fragment, url):
    """HTML -> clean Markdown via trafilatura; returns '' when it gives up."""
    try:
        import trafilatura
    except ImportError:
        return ''
    try:
        md = trafilatura.extract(
            '<html><body>' + fragment + '</body></html>',
            url=url,
            output_format='markdown',
            include_links=True,
            include_formatting=True,
            include_tables=True,
            favor_recall=True,
        )
        return (md or '').strip()
    except Exception as exc:
        print(f'  trafilatura 失败，回退纯文本: {exc}')
        return ''


def generic_extract(page, url):
    """Any ordinary web page -> (title, markdown, date) through trafilatura."""
    try:
        import trafilatura
    except ImportError:
        return '', '', time.strftime('%Y-%m-%d')
    md = trafilatura.extract(
        page, url=url, output_format='markdown',
        include_links=True, include_formatting=True, include_tables=True,
    )
    if not md:
        return '', '', time.strftime('%Y-%m-%d')
    title = ''
    date = time.strftime('%Y-%m-%d')
    try:
        meta = trafilatura.extract_metadata(page, default_url=url)
        if meta is not None:
            title = (meta.title or '').strip()
            if meta.date:
                date = str(meta.date)[:10]
    except Exception:
        pass
    return title, md.strip(), date


def extract(page):
    m = re.search(r'<div[^>]+id="js_content"[^>]*>(.*?)</div>\s*<script', page, re.S)
    if not m:
        m = re.search(r'<div[^>]+id="js_content"[^>]*>(.*)</div>', page, re.S)
    if not m:
        # not a WeChat article (or a JS-rendered shell): let trafilatura try the whole page
        title, md, date = generic_extract(page, PAGE_URL)
        return title, md, date
    raw = m.group(1)
    raw = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', raw, flags=re.S | re.I)
    md = to_markdown(raw, PAGE_URL)
    raw = BLOCK.sub('\n', raw)
    text = html.unescape(re.sub(r'<[^>]+>', '', raw))
    lines = [re.sub(r'[ \t\u00a0]+', ' ', ln).strip() for ln in text.split('\n')]
    body = '\n\n'.join([ln for ln in lines if ln])
    body = re.sub(r'\n{3,}', '\n\n', body).strip()
    if len(md) > 40:
        body = md

    t = re.search(r'<h1[^>]*class="rich_media_title"[^>]*>(.*?)</h1>', page, re.S)
    title = html.unescape(re.sub(r'<[^>]+>', '', t.group(1))).strip() if t else ''
    if not title:
        t = re.search(r'<meta property="og:title" content="(.*?)"', page, re.S)
        title = html.unescape(t.group(1)).strip() if t else ''
    if not title:
        t = re.search(r'var msg_title = [\'"](.*?)[\'"]', page)
        title = html.unescape(t.group(1)).strip() if t else ''
    d = re.search(r'var ct = "?(\d{10})"?', page)
    date = time.strftime('%Y-%m-%d', time.localtime(int(d.group(1)))) if d else time.strftime('%Y-%m-%d')
    return title, body, date


def slug(s):
    s = re.sub(r'[\\/:*?"<>|\s]+', '-', s).strip('-')
    return s[:70] or 'article'


def fetch(url):
    s = requests.Session()
    for attempt in range(3):
        try:
            r = s.get(url, timeout=25, headers={
                'User-Agent': UA[attempt % len(UA)],
                'Referer': 'https://mp.weixin.qq.com/',
                'Accept-Language': 'zh-CN,zh;q=0.9',
            })
            if 'wappoc_appmsgcaptcha' in r.text or '环境异常' in r.text:
                print(f'  验证码，等 45 秒重试 ({attempt + 1}/3)')
                time.sleep(45)
                continue
            return r.text
        except Exception as e:
            print(f'  请求失败 {e}')
            time.sleep(5)
    return ''


def main(urls):
    global PAGE_URL
    os.makedirs(OUT, exist_ok=True)
    ok = 0
    for url in urls:
        PAGE_URL = url
        page = fetch(url)
        if not page:
            print(f'失败（拿不到页面）: {url}')
            continue
        title, body, date = extract(page)
        if len(body) < 120:
            print(f'失败（正文太短 {len(body)} 字）: {url}')
            continue
        h = hashlib.sha1(url.encode()).hexdigest()[:8]
        path = os.path.join(OUT, f'{date}-{slug(title)}-{h}.md')
        with open(path, 'w', encoding='utf-8') as f:
            f.write('---\n')
            f.write(f'title: "{title[:120]}"\n')
            f.write(f'date: "{date}"\n')
            f.write('kind: import\n')
            f.write('type: article\n')
            f.write('source: "wechat-url"\n')
            f.write(f'url: "{url}"\n')
            f.write('---\n\n')
            f.write(f'# {title}\n\n{body}\n')
        print(f'OK {len(body)} 字 | {title[:40]}')
        ok += 1
        time.sleep(1.2)
    print(f'抓取完成: {ok}/{len(urls)}')


if __name__ == '__main__':
    main(sys.argv[1:])
