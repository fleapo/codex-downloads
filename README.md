# Codex for Windows — 下载页

一个提供 Codex（OpenAI）Windows 版 `.msix` 安装包下载链接的极简站点。

项目部署为**单个 Cloudflare Worker**：React 静态页面、`/api/*`、每 10 分钟执行一次的
Cron Trigger 和 KV 绑定都由同一份 `wrangler.jsonc` 管理。Cloudflare 首次部署时自动创建
KV，不需要在 GitHub 修改 KV ID，也不需要配置 `CLOUDFLARE_API_TOKEN` 或
`CLOUDFLARE_ACCOUNT_ID`。

## 架构

```text
                         每 10 分钟
Cloudflare Cron Trigger ───────────┐
                                  ▼
浏览器 ──► Worker Static Assets + API ──► 抓取 rg-adguard ──► KV
              │                         ▲                 │
              └──── GET /api/links ─────┴──── 读取快照 ───┘
```

- `fetch` 处理器负责 `/api/links` 和 `/api/links/refresh`
- `scheduled` 处理器由 `*/10 * * * *` 触发，即每 10 分钟更新一次 URL
- KV key 为 `snapshot`
- 首次访问时如果 KV 还没有数据，`GET /api/links` 会立即抓取一次作为冷启动兜底
- 抓取失败时保留上一次成功数据，并把错误写入快照

将定时任务和网页合并到同一个 Worker **不会影响每 10 分钟更新**。HTTP 请求与 Cron
Trigger 是两个独立入口，只是共享同一份代码和 KV 绑定。

## 目录结构

```text
codex-downloads/
├── web/                         # Vite + React 前端
├── worker/
│   ├── src/index.ts             # fetch + scheduled 处理器
│   ├── src/rg-adguard.ts        # 抓取、解析和 KV 快照逻辑
│   └── tsconfig.json
├── wrangler.jsonc               # 静态资源、Cron、KV 与可观测性配置
├── worker-configuration.d.ts    # Wrangler 根据配置生成的 Env 类型
├── package.json
└── package-lock.json
```

## 部署到 Cloudflare

### 1. 推送到 GitHub

把仓库推送到 GitHub 的 `master` 分支。仓库中不需要填写 Cloudflare Account ID、API Token
或 KV Namespace ID。

### 2. 创建 Worker 并连接仓库

1. 打开 Cloudflare Dashboard → **Workers & Pages**。
2. 选择 **Create application / Create Worker**，然后选择从 Git 仓库导入。
3. 授权 GitHub 并选择此仓库。
4. 使用以下构建设置：

| 配置项 | 值 |
| --- | --- |
| Production branch | `master` |
| Root directory | 留空 |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

Workers Builds 会自动创建部署所需的 Cloudflare API Token；不需要把 Token 保存到 GitHub
Secrets。

### 3. 首次部署

点击 **Save and Deploy**。首次部署时，Wrangler 会根据下面的声明自动创建并绑定 KV：

```jsonc
"kv_namespaces": [
  { "binding": "CODEX_LINKS" }
]
```

`id` 被有意省略。通过 Cloudflare 的 Git 构建部署时，生成的 KV ID 保存在 Cloudflare
账号中，不会要求回写 GitHub 仓库。Cloudflare 当前将自动资源创建标记为 Beta；项目已锁定
验证过的 Wrangler 版本，避免构建环境自动漂移。

部署完成后，同一个 Worker 会同时获得：

- `workers.dev` 访问地址
- React 静态页面
- `/api/links` 与 `/api/links/refresh`
- `CODEX_LINKS` KV binding
- `*/10 * * * *` Cron Trigger

以后只需 push 到 `master`，Cloudflare 会自动构建和部署，不再需要修改其他配置。

## 验证部署

假设 Worker 地址为 `https://codex-downloads.<你的子域>.workers.dev`：

```bash
curl https://codex-downloads.<你的子域>.workers.dev/api/links
curl -X POST https://codex-downloads.<你的子域>.workers.dev/api/links/refresh
```

还可以在 Dashboard 中确认：

1. Worker → **Settings → Bindings** 中存在 `CODEX_LINKS`
2. Worker → **Settings → Triggers** 中存在 `*/10 * * * *`
3. Worker → **Logs** 中每 10 分钟出现 `scheduled refresh completed`

Cron 配置更新可能需要短暂时间传播。即使第一次 Cron 尚未执行，首次 API 请求也会自动
填充 KV。

## 从旧版 Pages + Cron Worker 迁移

旧版部署使用一个 Pages 项目和一个 `codex-downloads-cron` Worker。建议按以下顺序迁移：

1. 先部署并验证新的单 Worker。
2. 如果使用自定义域名，把域名切换到新 Worker。
3. 确认新 Worker 的 API、KV 和 Cron Trigger 正常。
4. 在 Cloudflare Dashboard 停用或删除旧的 `codex-downloads-cron` Worker。
5. 不再需要旧 Pages 项目后再将其删除。

新的 KV 会在首次访问或首次 Cron 执行时自动生成快照，因此无需迁移旧 KV 中的临时下载
链接。停用旧 Cron 是为了避免旧任务继续产生重复抓取和写入。

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
- 查看定时任务：Worker → **Settings → Triggers**。
- 查看抓取日志：Worker → **Logs**。

Cloudflare 文档：

- [Wrangler 自动创建资源](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Workers Builds 配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
