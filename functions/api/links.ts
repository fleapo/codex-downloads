import {
  readSnapshot,
  refreshAndPersist,
  type LinksSnapshot,
} from "../_lib/rg-adguard";

interface Env {
  CODEX_LINKS: KVNamespace;
}

const JSON_HEADERS: HeadersInit = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
};

/** GET /api/links — 直接读 KV,冷启动无数据时兜底抓一次 */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  let snap: LinksSnapshot | null = await readSnapshot(env.CODEX_LINKS);
  if (!snap || !snap.data) {
    // KV 里没有(cron 还没跑过 / 首次上线)时兜底抓一次
    snap = await refreshAndPersist(env.CODEX_LINKS, snap);
  }
  return new Response(JSON.stringify(snap), { headers: JSON_HEADERS });
};
