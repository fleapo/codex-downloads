# Codex for Windows — 下载页

一个提供 Codex(OpenAI)Windows 版 `.msix` 安装包下载链接的极简站点。
后台定时从 [store.rg-adguard.net](https://store.rg-adguard.net/) 抓取最新的 x64 / arm64
镜像地址,写入 KV;前端页面直接读 KV 返回的快照渲染。

- **前端**:Vite + React,深色极简风,细节动效丰富(极光背景、渐变标题、卡片悬停光晕、按钮 shimmer、复制反馈等)
- **后端**:Cloudflare Pages Functions(`/api/*`)
- **定时任务**:独立的 Cloudflare Cron Worker,每 10 分钟抓一次
- **缓存**:Cloudflare Workers KV,Pages Functions 和 Cron Worker 共用同一个 namespace

## 目录结构

```
codex-downloads/
├── web/                        # Vite + React 前端
│   ├── src/App.tsx
│   ├── vite.config.ts          # /api 代理到 wrangler pages dev (8788)
│   └── package.json
├── functions/                  # Cloudflare Pages Functions
│   ├── _lib/rg-adguard.ts      # 抓取 & HTML 解析 & KV 读写(fetch 版)
│   └── api/
│       ├── links.ts            # GET  /api/links          读 KV,冷启动兜底
│       └── links/refresh.ts    # POST /api/links/refresh  强制刷新
├── worker-cron/                # 独立的 Cron Worker
│   ├── src/index.ts            # scheduled handler:抓 + 写 KV
│   └── wrangler.toml           # cron: */10 * * * *
├── package.json                # 根目录:wrangler + workers-types
└── .gitignore
```

## 数据流

```
        每 10 分钟                        读取
Cron Worker ─────► 抓 rg-adguard ─► KV ────► Pages Function ─► 前端
                                    ▲
                                    │ POST /api/links/refresh
                                    │ (前端刷新按钮 / 手动 curl)
```

- 快照 JSON 存在 KV key `snapshot` 下
- 首次上线 KV 里没数据时,`GET /api/links` 会兜底抓一次

---

# 部署到 Cloudflare

## 前置准备

1. 注册 [Cloudflare 账号](https://dash.cloudflare.com/sign-up)(免费即可)
2. 本地安装 wrangler CLI 并登录:
   ```bash
   npm i -g wrangler
   wrangler login    # 浏览器完成 OAuth
   ```

## Step 1 — 推到 GitHub

```bash
cd codex-downloads
git init
git add .
git commit -m "init: codex downloads on cloudflare"
git remote add origin git@github.com:<你的用户名>/codex-downloads.git
git branch -M main
git push -u origin main
```

## Step 2 — 创建 KV Namespace(Pages 和 Cron Worker 共用)

```bash
wrangler kv namespace create CODEX_LINKS
```

输出示例:

```
🌀 Creating namespace with title "codex-downloads-CODEX_LINKS"
✨ Success!
[[kv_namespaces]]
binding = "CODEX_LINKS"
id = "abc123def456..."     ← 记下这个 id
```

## Step 3 — 部署 Pages(前端 + `/api/*`)

### 3.1 在 Cloudflare Dashboard 创建 Pages 项目

1. Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 选择刚 push 的 `codex-downloads` 仓库
3. **Build settings:**
   - Framework preset:**None**
   - Build command:`cd web && npm install && npm run build`
   - Build output directory:`web/dist`
   - Root directory:留空
4. 点 **Save and Deploy**,等首次部署完成(约 1-2 分钟)

### 3.2 绑定 KV 到 Pages

1. 进入 Pages 项目 → **Settings** → **Bindings** → **KV namespace bindings** → **Add binding**
2. Variable name:`CODEX_LINKS`
3. KV namespace:选 Step 2 创建的那个
4. **Save**,然后回到 **Deployments** → 点最新一次的 **Retry deployment** 让绑定生效

部署完成后会拿到一个域名,例如 `https://codex-downloads.pages.dev`。此时前端已可访问,`/api/links` 也可用(首次访问会兜底抓一次)。

## Step 4 — 部署 Cron Worker

### 4.1 填入 KV id

编辑 `worker-cron/wrangler.toml`,把 `REPLACE_WITH_KV_NAMESPACE_ID` 换成 Step 2 输出的 id:

```toml
[[kv_namespaces]]
binding = "CODEX_LINKS"
id = "abc123def456..."       # ← 粘贴这里
```

### 4.2 部署

```bash
cd worker-cron
npm install
npx wrangler deploy
```

成功输出会显示 cron trigger 已注册:

```
Uploaded codex-downloads-cron (1.24 sec)
Deployed codex-downloads-cron triggers (0.87 sec)
  schedule: */10 * * * *
```

### 4.3(可选)手动触发一次验证

```bash
# worker 的 workers.dev 域名可以在 dashboard 的 worker 详情里找到
curl -X POST https://codex-downloads-cron.<你的账号>.workers.dev/tick
```

返回值就是最新的 snapshot JSON。

## Step 5 — 验证

1. 浏览器打开 `https://codex-downloads.pages.dev`,应能看到 x64 / arm64 下载卡
2. 直接测 API:
   ```bash
   curl https://codex-downloads.pages.dev/api/links | jq .
   curl -X POST https://codex-downloads.pages.dev/api/links/refresh | jq .
   ```
3. Dashboard → **Workers & Pages → codex-downloads-cron → Logs** 可看到每 10 分钟的 scheduled 调用

---

# 本地开发

```bash
# 一次装好三处依赖
npm run install:all

# 终端 1:启动 wrangler pages dev,提供 /api/* 和一个本地 KV
npm run dev:pages

# 终端 2:启动 Vite 前端,自动把 /api 代理到 8788
npm run dev:web

# (可选)终端 3:本地跑 cron worker
npm run dev:cron
```

浏览器打开 <http://127.0.0.1:3000/> 即可。

---

# 后续维护

- **更新前端 / API 代码**:`git push` 到 main → Pages 自动重新部署
- **更新 Cron Worker 代码**:`cd worker-cron && npx wrangler deploy`
- **查看 KV**:`wrangler kv key list --binding=CODEX_LINKS --remote`,或 dashboard 的 KV 页面
- **看日志**:
  - Pages Function 报错:dashboard → Pages 项目 → **Functions**
  - Cron Worker 日志:`npx wrangler tail codex-downloads-cron`

---

# 免费额度说明

| 服务 | 免费额度 | 本项目用量 |
| --- | --- | --- |
| Cloudflare Pages | 500 次 build/月,无限带宽 | 每次 push 一次 build |
| Workers(含 cron) | 100k 请求/天 | 144/天(cron)+ 用户访问 |
| Workers KV | 100k 读/天,1000 写/天 | 144 写/天 + 每次前端访问 1 读 |

免费额度足够长期运行。
