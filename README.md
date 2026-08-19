# Codex for Windows — 下载页

一个提供 Codex（OpenAI）Windows 版 `.msix` 安装包下载链接的极简站点。

项目部署为**单个 Cloudflare Worker**：React 静态页面、API、R2 下载、每 10 分钟执行一次
的 Cron Trigger、KV 和 R2 绑定都由同一份 `wrangler.jsonc` 管理。Cloudflare 首次部署时
自动创建 KV 与 R2 Bucket，不需要在 GitHub 修改资源 ID，也不需要配置
`CLOUDFLARE_API_TOKEN` 或 `CLOUDFLARE_ACCOUNT_ID`。

## 架构

```text
Cloudflare Cron Trigger（每 10 分钟）
              │
              ▼
      Worker scheduled ──► 抓取 rg-adguard
              │                 │
              │                 └── 新 SHA-1 ──► 校验并写入 R2
              └── R2 完成后发布只读 KV 快照

浏览器 ──► Worker Static Assets
  └─────► GET /api/links ──► 只读 KV 快照
  └─────► GET /download/* ──► 流式读取私有 R2 对象
  └─────► sourceUrl ──► 可选的 Microsoft 原始 HTTP 下载
```

- `fetch` 处理器只读取 KV/R2，不会触发上游抓取或写入
- `scheduled` 处理器由 `*/10 * * * *` 触发，即每 10 分钟检查一次版本
- 只有 SHA-1 变化时才从 Microsoft 下载文件；R2 写入时校验 SHA-1
- 两种架构都镜像成功后才发布新快照，失败时继续使用上一次成功版本
- 项目不公开手动同步接口，也不会在首次访问时同步
- KV key 为 `snapshot`
- R2 object key 为 `packages/<sha1>.msix`，下载支持 `GET`、`HEAD` 和 Range 断点续传
- 自动保留当前和上一版本两代对象，清理更旧的对象
- API 同时返回 HTTPS R2 地址 `url` 和 Microsoft 原始地址 `sourceUrl`
- 页面同时提供 R2/原始地址的下载与复制按钮，并明确标识原始 HTTP 的安全提示
- 首次 Cron 尚未完成镜像时，页面会提示等待定时同步
- 抓取失败时保留上一次成功数据，并把错误写入快照
- 页面显示的源链接到期时间由浏览器转换为访问者所在时区；本站 R2 下载地址不会随源链接到期

将定时任务和网页合并到同一个 Worker **不会影响每 10 分钟更新**。HTTP 请求与 Cron
Trigger 是两个独立入口，只是共享同一份代码、KV 和 R2 绑定。

## 目录结构

```text
codex-downloads/
├── web/                         # Vite + React 前端
├── worker/
│   ├── src/index.ts             # fetch + scheduled 处理器
│   ├── src/rg-adguard.ts        # 抓取、解析和 KV 快照逻辑
│   ├── src/r2-packages.ts       # R2 镜像、清理和 Range 下载逻辑
│   └── tsconfig.json
├── wrangler.jsonc               # 静态资源、Cron、KV、R2 与可观测性配置
├── worker-configuration.d.ts    # Wrangler 根据配置生成的 Env 类型
├── package.json
└── package-lock.json
```

## 部署到 Cloudflare

### 1. 推送到 GitHub

把仓库推送到 GitHub 的 `master` 分支。仓库中不需要填写 Cloudflare Account ID、API Token、
KV Namespace ID 或 R2 Bucket 名称。现有 Workers Builds 会在每次 push 后自动重新部署。

### 2. 创建 Worker 并连接仓库

1. 打开 Cloudflare Dashboard → **Workers & Pages**。
2. 选择 **Create application → Import a repository → Get started**，不要进入 Pages 的
   **Connect to Git** 流程。
3. 授权 GitHub 并选择此仓库。
4. 使用以下构建设置：

| 配置项 | 值 |
| --- | --- |
| Production branch | `master` |
| Root directory | 留空 |
| Build command | `npm run build` |
| Deploy command | 如果页面显示该项，填写 `npx wrangler deploy`；未显示则使用默认值即可 |

Workers Builds 会自动创建部署所需的 Cloudflare API Token；不需要把 Token 保存到 GitHub
Secrets。

### 3. 首次部署

点击 **Save and Deploy**。首次部署时，Wrangler 会根据下面的声明自动创建并绑定 KV 与
私有 R2 Bucket：

```jsonc
"kv_namespaces": [
  { "binding": "CODEX_LINKS" }
],
"r2_buckets": [
  { "binding": "CODEX_PACKAGES" }
]
```

KV 的 `id` 和 R2 的 `bucket_name` 被有意省略。通过 Cloudflare 的 Git 构建部署时，资源信息
保存在 Cloudflare 账号中，不会要求回写 GitHub 仓库。Cloudflare 当前将自动资源创建标记为
Beta；项目已锁定验证过的 Wrangler 版本，避免构建环境自动漂移。

Cloudflare 账号需要事先开通 R2 Subscription。开通后不需要手动创建 Bucket、开放公共访问、
绑定自定义域名或添加环境变量。

部署完成后，同一个 Worker 会同时获得：

- `workers.dev` 访问地址
- React 静态页面
- 只读的 `GET /api/links`
- 支持断点续传的 `GET/HEAD /download/*`
- `CODEX_LINKS` KV binding
- `CODEX_PACKAGES` R2 binding
- `*/10 * * * *` Cron Trigger

以后只需 push 到 `master`，Cloudflare 会自动构建和部署，不再需要修改其他配置。第一次包含
R2 配置的部署完成后，需要等待 Cron 下载约 1.4 GB 的两个安装包并发布快照；这个过程可能
需要几分钟。

## 验证部署

假设 Worker 地址为 `https://codex-downloads.<你的子域>.workers.dev`：

```bash
curl https://codex-downloads.<你的子域>.workers.dev/api/links
```

响应中的 `url` 是 R2 HTTPS 地址，`sourceUrl` 是 Microsoft 原始 HTTP 地址。从
`data.x64.url` 或 `data.arm64.url` 复制路径，验证 R2 下载和断点续传：

```bash
curl -I "https://codex-downloads.<你的子域>.workers.dev/download/<sha1>/<文件名>"
curl -H "Range: bytes=0-1023" \
  "https://codex-downloads.<你的子域>.workers.dev/download/<sha1>/<文件名>" \
  -o test.part
```

`POST /api/links/refresh` 不存在；访问该路径会返回 `404`，不会触发同步。

还可以在 Dashboard 中确认：

1. Worker → **Settings → Bindings** 中存在 `CODEX_LINKS` 和 `CODEX_PACKAGES`
2. Worker → **Settings → Triggers → Cron Triggers** 中存在 `*/10 * * * *`
3. Worker → **Observability** 中每 10 分钟出现 `scheduled refresh completed`
4. R2 Bucket 的 `packages/` 目录中存在 x64 和 arm64 对象

Cron 配置更新可能需要短暂时间传播。新 R2 Bucket 在第一次 Cron 完成前没有安装包，这是
预期行为；HTTP 请求不会触发同步，请等待镜像完成后刷新页面。

## 从旧版 Pages + Cron Worker 迁移

旧版部署使用一个 Pages 项目和一个 `codex-downloads-cron` Worker。建议按以下顺序迁移：

1. 先部署并验证新的单 Worker。
2. 如果使用自定义域名，把域名切换到新 Worker。
3. 确认新 Worker 的 API、KV、R2 和 Cron Trigger 正常。
4. 在 Cloudflare Dashboard 停用或删除旧的 `codex-downloads-cron` Worker。
5. 不再需要旧 Pages 项目后再将其删除。

新的 R2 Bucket 会在首次 Cron 中镜像文件并更新 KV 快照，因此无需迁移旧 KV 中的临时
下载链接。停用旧 Cron 是为了避免旧任务继续产生重复抓取和写入。

## 本地开发

安装依赖并生成绑定类型：

```bash
npm ci
npm run types
```

构建并启动本地 Worker（端口 `8788`）：

```bash
npm run dev
```

测试 API 和定时任务：

```bash
curl http://127.0.0.1:8788/api/links
curl "http://127.0.0.1:8788/cdn-cgi/handler/scheduled?cron=*/10+*+*+*+*"
```

第一个请求只读 KV；第二个请求模拟 Cron，也是本地环境中唯一会触发抓取和写入的入口。
模拟 Cron 会实际下载两个完整安装包到本地 R2，仅在确实需要端到端测试时执行。

需要前端热更新时，保持 Worker 运行，并在另一个终端启动 Vite：

```bash
npm run dev --workspace web
```

Vite 在 `3000` 端口运行，并把 `/api/*` 代理到本地 Worker 的 `8788` 端口。

提交前检查：

```bash
npm run check
npx wrangler deploy --dry-run
```

## 后续调整

- 修改刷新频率：同时修改 `wrangler.jsonc` 的 Cron 表达式，以及
  `worker/src/rg-adguard.ts` 中用于前端展示的刷新间隔。
- 查看 KV：Worker → **Settings → Bindings**，打开自动创建的 KV Namespace。
- 查看安装包：Worker → **Settings → Bindings**，打开自动创建的 R2 Bucket。
- 查看定时任务：Worker → **Settings → Triggers → Cron Triggers**。
- 查看抓取日志：Worker → **Observability**。

Cloudflare 文档：

- [Wrangler 自动创建资源](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [R2 定价](https://developers.cloudflare.com/r2/pricing/)
- [Workers Builds 配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
