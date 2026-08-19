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
│   ├── vite.config.ts
│   └── package.json
├── functions/                  # Cloudflare Pages Functions
│   ├── _lib/rg-adguard.ts      # 抓取 & HTML 解析 & KV 读写(fetch 版)
│   └── api/
│       ├── links.ts            # GET  /api/links          读 KV,冷启动兜底
│       └── links/refresh.ts    # POST /api/links/refresh  强制刷新
├── worker-cron/                # 独立的 Cron Worker
│   ├── src/index.ts            # scheduled handler:抓 + 写 KV
│   └── wrangler.toml           # cron 表达式与 KV 绑定
├── .github/workflows/          # GitHub Actions:自动部署 Cron Worker
└── .gitignore
```

## 数据流

```
        每 10 分钟                        读取
Cron Worker ─────► 抓 rg-adguard ─► KV ────► Pages Function ─► 前端
                                    ▲
                                    │ POST /api/links/refresh
                                    │ (前端刷新按钮)
```

- 快照 JSON 存在 KV key `snapshot` 下
- 首次上线 KV 里没数据时,`GET /api/links` 会兜底抓一次

---

# 部署到 Cloudflare

**全程网页操作**,不需要装任何 CLI,只用浏览器 + `git push`。

## 前置准备

- 注册 [Cloudflare 账号](https://dash.cloudflare.com/sign-up)(免费即可)
- 一个 GitHub 账号 + 新仓库

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

## Step 2 — 创建 KV Namespace

Cloudflare Dashboard → **Storage & Databases → KV → Create instance** → 名字填 `CODEX_LINKS` → **Add**。

创建后列表里能看到它的 ID(一串 32 位十六进制字符),点复制备用。

## Step 3 — 部署 Pages(前端 + `/api/*`)

### 3.1 创建 Pages 项目

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

## Step 4 — 部署 Cron Worker(GitHub Actions 自动)

> **说明**:Cron Worker 是一段常驻在 **Cloudflare 机房**的代码,由 Cloudflare 调度器每 10 分钟
> 触发一次。它跟 Pages 不同:Cloudflare **默认不会**从 GitHub 拉 Worker 代码,所以我们用
> GitHub Actions 帮忙推。配置完之后 push 就自动更新,不需要本地操作。

### 4.1 填入 KV id

在 GitHub 网页版编辑器里打开 `worker-cron/wrangler.toml`(或本地 clone 后编辑),
把 `REPLACE_WITH_KV_NAMESPACE_ID` 换成 Step 2 复制的 ID:

```toml
[[kv_namespaces]]
binding = "CODEX_LINKS"
id = "abc123def456..."       # ← 粘贴这里
```

保存并提交。

### 4.2 拿到 Cloudflare 的 API Token 和 Account ID

**Account ID**:
- Cloudflare Dashboard 主页右侧栏,或任意 Workers 详情页 URL 里能看到,格式如 `1a2b3c4d...`(32 位)

**API Token**:
1. Dashboard → 点右上头像 → **My Profile** → **API Tokens** → **Create Token**
2. 选 **Edit Cloudflare Workers** 模板(已包含所需权限)
3. Zone / Account Resources 保持默认(All zones / All accounts)
4. 点 **Continue to summary** → **Create Token**
5. **立刻复制 token**(只显示一次,关闭页面就没了)

### 4.3 在 GitHub 仓库里加两个 Secret

GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**,分别添加:

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 上一步复制的 token |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID |

### 4.4 触发首次部署

`.github/workflows/deploy-cron.yml` 已经在仓库里,触发条件:
- **push 到 main 且 `worker-cron/**` 或 `functions/_lib/**` 有改动**(自动)
- 或 GitHub → **Actions** tab → 选 **Deploy Cron Worker** → 点 **Run workflow**(手动)

首次可以直接手动 **Run workflow**,或者:

```bash
git commit --allow-empty -m "trigger: first cron worker deploy"
git push
```

GitHub Actions 面板里能看到实时日志,通常 30 秒到 1 分钟完成。成功后 Cloudflare Dashboard → **Workers & Pages** 会出现 `codex-downloads-cron`。

## Step 5 — 验证

1. 浏览器打开 `https://codex-downloads.pages.dev`,应能看到 x64 / arm64 下载卡
2. 直接测 API:
   ```bash
   curl https://codex-downloads.pages.dev/api/links | jq .
   curl -X POST https://codex-downloads.pages.dev/api/links/refresh | jq .
   ```
3. Dashboard → **Workers & Pages → codex-downloads-cron → Logs** 可看到每 10 分钟的 scheduled 调用记录

---

# 后续维护

- **更新前端 / API 代码**:`git push` 到 main → Pages **自动**重新部署
- **更新 Cron Worker 代码**:`git push` 到 main(且改到了 `worker-cron/**` 或 `functions/_lib/**`)→ GitHub Actions **自动**重新部署
- **查看 KV**:Cloudflare Dashboard → **Storage & Databases → KV → CODEX_LINKS**,可以浏览、编辑、删除 key
- **看日志**:
  - Pages Function 错误:Dashboard → Pages 项目 → **Functions** → **Real-time logs**
  - Cron Worker 日志:Dashboard → Workers & Pages → `codex-downloads-cron` → **Logs** / **Real-time Logs**

---

# 免费额度说明

| 服务 | 免费额度 | 本项目用量 |
| --- | --- | --- |
| Cloudflare Pages | 500 次 build/月,无限带宽 | 每次 push 一次 build |
| Workers(含 cron) | 100k 请求/天 | 144/天(cron)+ 用户访问 |
| Workers KV | 100k 读/天,1000 写/天 | 144 写/天 + 每次前端访问 1 读 |

免费额度足够长期运行。
