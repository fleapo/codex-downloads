import { readSnapshot, refreshAndPersist } from "../../_lib/rg-adguard";

interface Env {
  CODEX_LINKS: KVNamespace;
}

const JSON_HEADERS: HeadersInit = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
};

/** POST /api/links/refresh — 强制刷新,忽略下次刷新时间 */
export const onRequestPost: PagesFunction<Env> = async ({ env }) => {
  const prev = await readSnapshot(env.CODEX_LINKS);
  const snap = await refreshAndPersist(env.CODEX_LINKS, prev);
  return new Response(JSON.stringify(snap), { headers: JSON_HEADERS });
};
