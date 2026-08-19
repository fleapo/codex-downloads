/**
 * Cron Worker: 每分钟触发,检查是否达到 snapshot.nextRefreshAt,
 * 到期后抓取一次 rg-adguard 并写回 KV。
 * KV namespace 与 Pages Functions 共用 (CODEX_LINKS)。
 */
import {
  isDue,
  readSnapshot,
  refreshAndPersist,
} from "../../functions/_lib/rg-adguard";

export interface Env {
  CODEX_LINKS: KVNamespace;
}

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(tick(env));
  },

  /**
   * 保留 fetch handler,方便通过 wrangler dev 或浏览器手动触发一次抓取用于调试:
   *   curl -X POST https://<worker-domain>/tick
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/tick" && request.method === "POST") {
      const snap = await refreshAndPersist(env.CODEX_LINKS);
      return new Response(JSON.stringify(snap, null, 2), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    return new Response("codex-cron worker up", { status: 200 });
  },
};

async function tick(env: Env): Promise<void> {
  const snap = await readSnapshot(env.CODEX_LINKS);
  if (!isDue(snap)) return;
  await refreshAndPersist(env.CODEX_LINKS, snap);
}
