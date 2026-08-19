# Web 前端

这里是 Codex Windows 下载页的 Vite + React 前端。

生产环境中，`web/dist` 由根目录的 Cloudflare Worker Static Assets 提供；前端调用同域名
下的 `/api/*`，不再单独部署到 Cloudflare Pages。

常用命令请从仓库根目录执行：

```bash
npm run build
npm run dev
npm run check
```

前端热更新可单独运行：

```bash
npm run dev --workspace web
```

Vite 会把 `/api/*` 代理到 `http://127.0.0.1:8788`，因此联调时需要同时运行根目录的
`npm run dev`。
