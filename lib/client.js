window.__ModuleLoader__.load({
  id: '@local/dsh-kb',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const API = 'http://127.0.0.1:8765';
    const PANEL_ID = 'dsh-kb';

    // ---- conversation store: survives panel switches and app reloads ----
    const HISTORY_KEY = 'dsh-kb-history-v1';
    const MAX_TURNS = 40;

    function loadHistory() {
      try {
        const raw = window.localStorage.getItem(HISTORY_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.slice(-MAX_TURNS) : [];
      } catch { return []; }
    }

    const history = { messages: loadHistory(), listeners: new Set() };

    function persistHistory() {
      try {
        const trimmed = history.messages.slice(-MAX_TURNS).map((m) => ({
          role: m.role,
          content: String(m.content || '').slice(0, 20000),
          sources: Array.isArray(m.sources) ? m.sources.slice(0, 12) : undefined,
          ms: m.ms,
        }));
        window.localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
      } catch { /* quota or private mode: keep in memory only */ }
    }

    function notify() {
      for (const fn of history.listeners) { try { fn(); } catch { /* ignore */ } }
    }

    function pushMessage(msg) {
      history.messages = [...history.messages, msg].slice(-MAX_TURNS);
      persistHistory();
      notify();
    }

    function clearHistory() {
      history.messages = [];
      persistHistory();
      notify();
    }

    const S = {
      root: {
        display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box',
        color: 'var(--dsw-alias-label-primary, #e6e6e6)', fontSize: 14, lineHeight: 1.65,
      },
      header: {
        flex: 'none', display: 'flex', alignItems: 'baseline', gap: 10,
        padding: '18px 24px 10px', borderBottom: '1px solid var(--dsw-alias-border-muted, rgba(255,255,255,.08))',
      },
      h1: { fontSize: 17, fontWeight: 600, margin: 0 },
      sub: { color: 'var(--dsw-alias-label-tertiary, #8a8a8a)', fontSize: 12 },
      scroller: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 24px 8px' },
      thread: { maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 },
      rowUser: { display: 'flex', justifyContent: 'flex-end' },
      rowBot: { display: 'flex', justifyContent: 'flex-start' },
      bubbleUser: {
        maxWidth: '78%', padding: '10px 14px', borderRadius: '14px 14px 4px 14px',
        background: 'var(--dsw-alias-accent, #3b6ef0)', color: '#fff', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      },
      bubbleBot: {
        maxWidth: '86%', padding: '12px 16px', borderRadius: '14px 14px 14px 4px',
        background: 'var(--dsw-alias-bg-elevated, rgba(255,255,255,.05))',
        border: '1px solid var(--dsw-alias-border-muted, rgba(255,255,255,.08))',
        wordBreak: 'break-word',
      },
      meta: { color: 'var(--dsw-alias-label-tertiary, #8a8a8a)', fontSize: 11, marginTop: 6 },
      sources: { marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 },
      srcRow: { color: 'var(--dsw-alias-label-secondary, #9aa0a6)', wordBreak: 'break-all' },
      composer: {
        flex: 'none', padding: '10px 24px 20px',
        borderTop: '1px solid var(--dsw-alias-border-muted, rgba(255,255,255,.08))',
      },
      composerInner: { maxWidth: 880, margin: '0 auto', display: 'flex', gap: 10, alignItems: 'flex-end' },
      input: {
        flex: 1, minHeight: 44, maxHeight: 140, padding: '11px 14px', borderRadius: 12,
        border: '1px solid var(--dsw-alias-border-muted, rgba(255,255,255,.14))',
        background: 'var(--dsw-alias-bg-input, rgba(255,255,255,.05))',
        color: 'inherit', fontSize: 14, lineHeight: 1.5, resize: 'none', outline: 'none',
        fontFamily: 'inherit',
      },
      btn: {
        height: 44, padding: '0 18px', borderRadius: 12, border: 'none', cursor: 'pointer',
        background: 'var(--dsw-alias-accent, #3b6ef0)', color: '#fff', fontSize: 14, flex: 'none',
      },
      btnOff: { opacity: 0.55, cursor: 'default' },
      empty: { color: 'var(--dsw-alias-label-tertiary, #8a8a8a)', fontSize: 13, textAlign: 'center', marginTop: 40 },
      tip: { color: 'var(--dsw-alias-label-tertiary, #8a8a8a)', fontSize: 11, textAlign: 'center', marginTop: 8 },
    };

    // ---- minimal markdown renderer (headings, bold, code, lists, quotes, links) ----
    const MD = {
      h2: { fontSize: 16, fontWeight: 600, margin: '14px 0 6px' },
      h3: { fontSize: 15, fontWeight: 600, margin: '12px 0 5px' },
      p: { margin: '7px 0' },
      code: {
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 12.5,
        background: 'var(--dsw-alias-bg-code, rgba(255,255,255,.10))',
        padding: '1px 5px', borderRadius: 5,
      },
      pre: {
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 12.5,
        background: 'var(--dsw-alias-bg-code, rgba(0,0,0,.28))',
        border: '1px solid var(--dsw-alias-border-muted, rgba(255,255,255,.10))',
        borderRadius: 8, padding: '10px 12px', overflowX: 'auto', margin: '9px 0',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.55,
      },
      li: { margin: '3px 0 3px 20px' },
      quote: {
        margin: '9px 0', padding: '4px 12px',
        borderLeft: '3px solid var(--dsw-alias-border-muted, rgba(255,255,255,.22))',
        color: 'var(--dsw-alias-label-secondary, #b9b9b9)',
      },
      a: { color: 'var(--dsw-alias-accent, #6b9bff)', textDecoration: 'underline' },
      hr: { border: 'none', borderTop: '1px solid var(--dsw-alias-border-muted, rgba(255,255,255,.12))', margin: '12px 0' },
      tableWrap: { overflowX: 'auto', margin: '10px 0' },
      table: { borderCollapse: 'collapse', fontSize: 12.5, minWidth: '100%' },
      th: {
        textAlign: 'left', padding: '6px 10px', fontWeight: 600, whiteSpace: 'nowrap',
        borderBottom: '1px solid var(--dsw-alias-border-muted, rgba(255,255,255,.22))',
        background: 'var(--dsw-alias-bg-code, rgba(255,255,255,.06))',
      },
      td: {
        padding: '6px 10px', verticalAlign: 'top',
        borderBottom: '1px solid var(--dsw-alias-border-muted, rgba(255,255,255,.08))',
      },
    };

    const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;

    function inlineNodes(text, keyBase) {
      const out = [];
      let last = 0;
      let m;
      let i = 0;
      INLINE.lastIndex = 0;
      while ((m = INLINE.exec(text)) !== null) {
        if (m.index > last) out.push(text.slice(last, m.index));
        const token = m[0];
        const k = keyBase + '-' + i++;
        if (token.startsWith('`')) {
          out.push(h('code', { style: MD.code, key: k }, token.slice(1, -1)));
        } else if (token.startsWith('**')) {
          out.push(h('strong', { key: k }, token.slice(2, -2)));
        } else if (token.startsWith('*')) {
          out.push(h('em', { key: k }, token.slice(1, -1)));
        } else {
          const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
          out.push(h('a', { key: k, href: lm[2], target: '_blank', rel: 'noreferrer', style: MD.a }, lm[1]));
        }
        last = m.index + token.length;
      }
      if (last < text.length) out.push(text.slice(last));
      return out;
    }

    function Markdown({ text }) {
      const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
      const blocks = [];
      let i = 0;
      let key = 0;

      while (i < lines.length) {
        const line = lines[i];

        if (/^\s*```/.test(line)) {
          const lang = line.trim().replace(/^```/, '');
          const buf = [];
          i++;
          while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
          i++;
          blocks.push(h('pre', { style: MD.pre, key: 'b' + key++ }, buf.join('\n')));
          continue;
        }

        if (/^\s*$/.test(line)) { i++; continue; }

        const hm = /^(#{1,4})\s+(.*)$/.exec(line);
        if (hm) {
          const level = Math.min(hm[1].length, 3);
          blocks.push(h(level <= 2 ? 'div' : 'div', {
            style: level <= 2 ? MD.h2 : MD.h3, key: 'b' + key++,
          }, inlineNodes(hm[2], 'h' + key)));
          i++;
          continue;
        }

        if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
          blocks.push(h('hr', { style: MD.hr, key: 'b' + key++ }));
          i++;
          continue;
        }

        if (/^\s*>\s?/.test(line)) {
          const buf = [];
          while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
            buf.push(lines[i].replace(/^\s*>\s?/, ''));
            i++;
          }
          blocks.push(h('div', { style: MD.quote, key: 'b' + key++ }, inlineNodes(buf.join(' '), 'q' + key)));
          continue;
        }

        if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
          const items = [];
          while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
            items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
            i++;
          }
          blocks.push(h('div', { key: 'b' + key++ },
            items.map((it, j) => h('div', { style: MD.li, key: j }, '• ', inlineNodes(it, 'li' + key + j)))));
          continue;
        }

        // pipe table: header row + separator row
        if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
          const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
          const head = cells(line);
          i += 2;
          const body = [];
          while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { body.push(cells(lines[i])); i++; }
          const tk = 't' + key;
          blocks.push(h('div', { style: MD.tableWrap, key: 'b' + key++ },
            h('table', { style: MD.table },
              h('thead', null, h('tr', null, head.map((c, j) =>
                h('th', { key: j, style: MD.th }, inlineNodes(c, tk + 'h' + j))))),
              h('tbody', null, body.map((r, ri) => h('tr', { key: ri },
                r.map((c, ci) => h('td', { key: ci, style: MD.td }, inlineNodes(c, tk + 'd' + ri + ci)))))))));
          continue;
        }

        const buf = [];
        while (i < lines.length && !/^\s*$/.test(lines[i]) &&
               !/^\s*(```|#{1,4}\s|>|[-*+]\s|\d+\.\s|\|)/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        blocks.push(h('div', { style: MD.p, key: 'b' + key++ }, inlineNodes(buf.join(' '), 'p' + key)));
      }

      return h('div', null, blocks);
    }

    function Chat() {
      const [messages, setMessages] = React.useState(() => history.messages.slice());
      const [text, setText] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [err, setErr] = React.useState('');
      const [filter, setFilter] = React.useState('');
      const [openSrc, setOpenSrc] = React.useState(null);
      const [rebuilding, setRebuilding] = React.useState(false);
      const [notice, setNotice] = React.useState('');
      const scroller = React.useRef(null);
      const box = React.useRef(null);

      // follow the shared store, no matter which panel instance is mounted
      React.useEffect(() => {
        const sync = () => setMessages(history.messages.slice());
        history.listeners.add(sync);
        sync();
        return () => { history.listeners.delete(sync); };
      }, []);

      React.useEffect(() => {
        const el = scroller.current;
        if (el) el.scrollTop = el.scrollHeight;
      }, [messages, busy]);

      const send = React.useCallback(async () => {
        const q = (text || '').trim();
        if (!q || busy) return;
        setText('');
        setErr('');
        const historyPayload = messages.map((m) => ({ role: m.role, content: m.content }));
        pushMessage({ role: 'user', content: q });
        setBusy(true);
        try {
          const r = await fetch(API + '/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ q, history: historyPayload, kind: filter || undefined }),
          });
          const data = await r.json();
          if (!r.ok || data.error) throw new Error(data.error || ('HTTP ' + r.status));
          pushMessage({ role: 'assistant', content: data.answer, sources: data.sources || [], ms: data.ms });
        } catch (e) {
          setErr(String(e.message || e));
          pushMessage({
            role: 'assistant',
            content: '检索服务不可用。请确认本地服务在运行：\npython C:\\Users\\范海华\\.dsh\\im\\kb\\server.py',
          });
        } finally {
          setBusy(false);
        }
      }, [text, busy, messages]);

      const rebuild = React.useCallback(async () => {
        if (rebuilding) return;
        setRebuilding(true);
        setNotice('正在导入 kb/inbox 并重建索引…（首次可能要一两分钟）');
        try {
          const r = await fetch(API + '/import', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
          });
          const d = await r.json();
          if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status));
          setNotice('索引已重建：' + d.chunks + ' 个段落，用时 ' + Math.round((d.ms || 0) / 1000) + ' 秒');
        } catch (e) {
          setNotice('重建失败：' + (e.message || e));
        } finally {
          setRebuilding(false);
        }
      }, [rebuilding]);

      const onKey = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      };

      const rows = messages.map((m, i) => {
        if (m.role === 'user') {
          return h('div', { style: S.rowUser, key: i }, h('div', { style: S.bubbleUser }, m.content));
        }
        return h('div', { style: S.rowBot, key: i },
          h('div', { style: S.bubbleBot },
            h(Markdown, { text: m.content }),
            m.sources && m.sources.length
              ? h('div', { style: S.sources },
                  h('div', { style: { ...S.meta, marginTop: 2 } }, '引用 ' + m.sources.length + ' 条资料 · 点开看原文片段'),
                  m.sources.map((s, j) => {
                    const openKey = i + ':' + j;
                    const isOpen = openSrc === openKey;
                    return h('div', { key: j },
                      h('div', {
                        style: { ...S.srcRow, cursor: 'pointer', padding: '3px 0' },
                        onClick: () => setOpenSrc(isOpen ? null : openKey),
                      },
                        (isOpen ? '▾ ' : '▸ ') + '（资料' + (j + 1) + '）',
                        s.url
                          ? h('a', {
                              href: s.url, target: '_blank', rel: 'noreferrer', style: MD.a,
                              onClick: (ev) => ev.stopPropagation(),
                            }, s.title)
                          : h('span', null, s.title),
                        ' · ' + s.date),
                      isOpen
                        ? h('div', {
                            style: {
                              margin: '4px 0 8px 14px', padding: '8px 10px', borderRadius: 8,
                              background: 'var(--dsw-alias-bg-code, rgba(0,0,0,.25))',
                              fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word', maxHeight: 260, overflowY: 'auto',
                            },
                          },
                            String(s.snippet || '（没有片段）'),
                            h('div', { style: { ...S.meta, marginTop: 6 } }, '文件：' + s.path))
                        : null);
                  }))
              : null,
            m.ms ? h('div', { style: S.meta }, '用时 ' + m.ms + ' ms') : null));
      });

      if (busy) rows.push(h('div', { style: S.rowBot, key: 'busy' },
        h('div', { style: S.bubbleBot }, '检索资料并整理中…')));

      return h('div', { style: S.root },
        h('div', { style: S.header },
          h('h1', { style: S.h1 }, '知识库'),
          h('span', { style: S.sub }, '159 篇全文 · 388 条笔记 · 可追问'),
          h('span', { style: { flex: 1 } }),
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            [['', '全部'], ['fav', '收藏'], ['chat', '自聊'], ['import', '导入']].map(([k, label]) =>
              h('button', {
                key: 'f' + k,
                onClick: () => setFilter(k),
                style: {
                  border: '1px solid var(--dsw-alias-border-muted, rgba(255,255,255,.14))',
                  background: filter === k ? 'var(--dsw-alias-accent, #3b6ef0)' : 'transparent',
                  color: filter === k ? '#fff' : 'var(--dsw-alias-label-secondary, #9aa0a6)',
                  fontSize: 11.5, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
                },
              }, label)),
            h('button', {
              onClick: rebuild,
              disabled: rebuilding,
              title: '把 kb/inbox 里的文件导入并重建索引',
              style: {
                border: '1px solid var(--dsw-alias-border-muted, rgba(255,255,255,.14))',
                background: 'transparent', color: 'var(--dsw-alias-label-secondary, #9aa0a6)',
                fontSize: 11.5, padding: '3px 10px', borderRadius: 999,
                cursor: rebuilding ? 'default' : 'pointer', opacity: rebuilding ? 0.6 : 1,
              },
            }, rebuilding ? '重建中…' : '重建索引'),
            messages.length
              ? h('button', {
                  onClick: clearHistory,
                  style: {
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    color: 'var(--dsw-alias-label-tertiary, #8a8a8a)', fontSize: 11.5, padding: 0,
                  },
                }, '清空')
              : null)),
        notice ? h('div', {
          style: { padding: '6px 24px 0', fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #8a8a8a)' },
        }, notice) : null,
        h('div', { style: S.scroller, ref: scroller },
          h('div', { style: S.thread },
            messages.length === 0
              ? h('div', { style: S.empty },
                  '直接提问，我会在你的收藏和笔记里找答案。',
                  h('div', { style: S.tip }, '例如：OOM score 怎么计算 / Claude Code 有哪些插件 / 内核栈溢出怎么排查'))
              : rows)),
        h('div', { style: S.composer },
          h('div', { style: S.composerInner },
            h('textarea', {
              style: S.input, value: text, rows: 1, ref: box,
              placeholder: '问点什么…（Enter 发送，Shift+Enter 换行）',
              onChange: (e) => setText(e.target.value), onKeyDown: onKey,
            }),
            h('button', {
              style: { ...S.btn, ...(busy || !text.trim() ? S.btnOff : {}) },
              onClick: send, disabled: busy,
            }, busy ? '…' : '发送'))));
    }

    function PanelIcon() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true,
      },
        h('rect', { x: 3.5, y: 4, width: 5, height: 16, rx: 1.2 }),
        h('rect', { x: 9.5, y: 4, width: 5, height: 16, rx: 1.2 }),
        h('rect', { x: 15.5, y: 4, width: 5, height: 16, rx: 1.2 }));
    }

    return {
      inject: ['slots', 'sidebarRightTabs'],
      apply(ctx) {
        const disposers = [];
        try {
          disposers.push(ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              { name: 'sidebar.panellist', id: PANEL_ID, order: 24, label: () => '知识库' },
              PanelIcon)));
        } catch (e) { console.warn('[dsh-kb] sidebar entry not mounted', e); }
        try {
          disposers.push(ctx.slots.inject('main', () =>
            ctx.slots.register({ name: 'main', key: PANEL_ID }, Chat)));
        } catch (e) { console.warn('[dsh-kb] main panel not mounted', e); }

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: '@local/dsh-kb',
          kind: 'kb',
          title: () => '知识库',
          guide: [{ id: 'kb', title: () => '知识库', description: () => '向你的笔记提问' }],
          keepMounted: true,
        }));
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: '@local/dsh-kb' },
          Chat));

        ctx.effect(() => () => {
          for (const d of disposers.splice(0)) { try { d(); } catch {} }
        });
      },
    };
  },
});
