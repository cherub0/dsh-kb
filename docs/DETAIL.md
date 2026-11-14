# 知识库（dsh-kb）

## 它做什么

把一个本地文件夹里的 Markdown / PDF / Word / 文本变成可以对话的知识库。左栏一个面板，直接用自然语言提问，
回答里带（资料N）引用，点开能看到命中的原文片段和文件路径。

## 组成

- **Host 半**（`lib/index.js`）：托管本地 Python 服务，首次启动把 `python/` 里的脚本铺到知识库目录，
  并注册三个 Agent 工具 `kb_search` / `kb_ask` / `kb_rebuild`。
- **Client 半**（`lib/client.js`）：左栏面板，聊天界面 + Markdown 渲染（含表格）+ 来源展开 + 重建按钮。
- **Python 服务**（`python/server.py`）：切块检索、MMR、RAG 生成、导入与重建，监听 `127.0.0.1:8765`。

## 数据在哪

默认 `~/.dsh/kb`：

```
notes/            每条资料一个 Markdown，带 frontmatter
chunk_emb.npy     段落向量
chunk_meta.json   段落元数据
chunk_embed_cache.npz  按段落哈希缓存的向量
inbox/            待导入文件，处理完移到 inbox/done/
```

## 用法

1. 把文件丢进 `inbox/`，点面板上的「重建索引」，或让 Agent 调 `kb_rebuild`。
2. 面板顶部可按来源筛选：全部 / 收藏 / 自聊 / 导入。
3. 提问后答案下方列出引用，点一条展开片段。

## 已知限制

- 检索质量受 `bge-small-zh-v1.5` 限制，超长文档里跨章节的答案可能取不全。
- 没有知识图谱、没有重排、只支持单一知识库。
- 扫描版 PDF（无文本层）会被跳过。
- `deepseek-reasoner` 每次问候约 15–40 秒。