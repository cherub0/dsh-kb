# dsh-kb

Local knowledge base for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — a chat panel in the
left sidebar that answers questions from **your own documents**, with citations.

Point it at a folder of Markdown, PDF, Word and text files. It chunks and embeds them locally, retrieves the most
relevant passages, and asks a chat model to answer from those passages only.

```
question ──> chunk retrieval (vector + keywords + MMR) ──> LLM synthesis ──> answer with （资料N） citations
```

Ask in natural language; get a synthesised answer instead of a link list.

![The knowledge-base panel answering a question, with 11 cited sources](docs/screenshot.jpg)

## What you get

- **A chat panel, not a search box.** Ask in natural language; get a synthesised answer instead of a link list.
- **Citations you can open.** Every answer lists its sources; click one to expand the matched passage and see the file.
- **Agent tools.** `kb_search`, `kb_ask` and `kb_rebuild` are registered, so the agent can consult your knowledge base
  mid-conversation without you opening the panel.
- **Document import.** Drop files into `kb/inbox/` (or hit **重建索引**) and they are parsed, chunked and indexed —
  PDF, DOCX, TXT, MD and common source files.
- **Incremental indexing.** Embeddings are cached by passage hash, so adding one document re-embeds only its chunks
  (seconds instead of minutes).
- **Source filters.** Separate `fav` / `chat` / `import` sources and restrict a question to one of them.
- **Web article import.** `python fetch_urls.py <url> …` pulls WeChat / public article text into the base.

## Requirements

- DeepSeek Harness 0.2.x
- Python 3.10+ with `sentence-transformers`, `numpy`, `requests`, `pyyaml`
  (`pip install sentence-transformers numpy requests pyyaml`); `pypdf` and `python-docx` are optional, for PDF/DOCX import
- A DeepSeek API key available at `~/.dsh/.credentials.yaml` (`refs.DEEPSEEK_API_KEY`) or in `DEEPSEEK_API_KEY`

The first start downloads the `BAAI/bge-small-zh-v1.5` embedding model (~95 MB, CPU only).

## Install

```bash
# from the profile that should host it
dsh plugin --profile <profile> add /absolute/path/to/dsh-kb
```

Or install the bundle through Plugin Manager using the directory path.

On first activation the plugin creates `~/.dsh/kb`, copies the Python service into it, and starts it on
`127.0.0.1:8765`. The panel appears as **知识库** in the left sidebar.

## Adding content

1. Drop files into `~/.dsh/kb/inbox/` — PDF, DOCX, TXT, MD, source files.
2. Click **重建索引** in the panel header (or ask the agent to run `kb_rebuild`).
3. Files move to `inbox/done/` once imported; notes land in `~/.dsh/kb/notes/import/`.

To fetch web articles:

```bash
cd ~/.dsh/kb
python fetch_urls.py https://mp.weixin.qq.com/s/xxxx https://example.com/post
```

Then rebuild. Each imported note is plain Markdown with frontmatter (`title`, `date`, `kind`, `url`), so you can also
write notes by hand.

## Configuration

The bundle row accepts:

| key | default | meaning |
| --- | --- | --- |
| `kbDir` | `~/.dsh/kb` | knowledge-base folder (notes, index, inbox) |
| `port` | `8765` | local service port |
| `python` | auto-detected | Python interpreter path |
| `script` | `<kbDir>/server.py` | override the service entry point |

Environment variables: `DSH_KB_DIR` (same as `kbDir`), `KB_CHAT_MODEL` (default `deepseek-reasoner`,
set to `deepseek-chat` for faster, cheaper answers).

## HTTP API

The local service is plain HTTP, so other tools can use it:

| route | purpose |
| --- | --- |
| `GET /search?q=…&k=8&kind=fav,chat` | chunk hits (MMR-diversified) |
| `POST /ask` `{"q","history","kind"}` | RAG answer with sources |
| `POST /rebuild` | re-chunk and re-embed changed passages |
| `POST /import` | import `inbox/` then rebuild |
| `GET /stats`, `GET /health` | index statistics, liveness |

## How retrieval works

1. Notes are split into ~700-character passages with 120-character overlap.
2. Passages are embedded with `bge-small-zh-v1.5`; vectors are cached by passage hash.
3. A query scores passages by cosine similarity plus a light lexical bonus (CJK bigrams + Latin words).
4. MMR (λ = 0.72) removes near-duplicates, then at most two passages per document are kept.
5. The top passages (grouped per document) become the prompt context for the answer.

## Limitations

- Retrieval quality is bounded by `bge-small-zh-v1.5`: good for Chinese and technical English, weaker on very long
  documents whose answer spans several sections.
- No knowledge graph, no reranker, no multi-library separation — this is deliberately a single local library.
- PDF extraction depends on `pypdf`; scanned PDFs without a text layer are skipped.
- Answer latency is dominated by the model: `deepseek-reasoner` typically takes 15–40 s per question.

## Notes for plugin developers

Three things cost real debugging time here; they are easy to repeat:

- **The client module `id` must equal the package name.** Renaming the package without renaming
  `window.__ModuleLoader__.load({ id: … })` loads the bundle but silently fails to mount it — no error, the sidebar
  entry just never appears.
- **Every tool needs `output: { schema, render }`.** Registration throws
  `tool "x" must declare output { schema, render, presentationMeta? }` otherwise, and the schema DSL rejects
  `required: true` on a string property — put `required` on the object, or omit it.
- **A `link:` dependency is materialised, not symlinked,** under pnpm's hoisted node-linker: editing the source
  directory does not change what the running Host loads until you reinstall the bundle.

## License

MIT — see [LICENSE](LICENSE).
