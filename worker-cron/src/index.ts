/**
 * Cron Worker:cron 每 10 分钟触发一次,抓取 rg-adguard 并写入 KV。
 * 与 Pages Functions 共用同一个 KV namespace (CODEX_LINKS)。
 */
import { refreshAndPersist } from "../../functions/_lib/rg-adguard";

export interface Env {
  CODEX_LINKS: KVNamespace;
}

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(refreshAndPersist(env.CODEX_LINKS));
  },
};
