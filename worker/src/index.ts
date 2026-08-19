import {
  readSnapshot,
  refreshAndPersist,
  type LinksSnapshot,
} from "./rg-adguard";

const JSON_HEADERS: HeadersInit = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

function methodNotAllowed(allowed: string): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { allow: allowed },
  });
}

async function getLinks(env: Env): Promise<Response> {
  let snapshot: LinksSnapshot | null = await readSnapshot(env.CODEX_LINKS);

  // 首次部署时 Cron 可能还未运行，直接抓取一次作为冷启动兜底。
  if (!snapshot?.data) {
    snapshot = await refreshAndPersist(env.CODEX_LINKS, snapshot);
  }

  return jsonResponse(snapshot);
}

async function refreshLinks(env: Env): Promise<Response> {
  const previous = await readSnapshot(env.CODEX_LINKS);
  const snapshot = await refreshAndPersist(env.CODEX_LINKS, previous);
  return jsonResponse(snapshot);
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname === "/api/links") {
    return request.method === "GET"
      ? getLinks(env)
      : methodNotAllowed("GET");
  }

  if (pathname === "/api/links/refresh") {
    return request.method === "POST"
      ? refreshLinks(env)
      : methodNotAllowed("POST");
  }

  return jsonResponse({ error: "Not Found" }, 404);
}

async function runScheduledRefresh(
  controller: ScheduledController,
  env: Env,
): Promise<void> {
  const previous = await readSnapshot(env.CODEX_LINKS);
  const snapshot = await refreshAndPersist(env.CODEX_LINKS, previous);

  console.log(
    JSON.stringify({
      message: "scheduled refresh completed",
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
      status: snapshot.status,
      lastError: snapshot.lastError,
      lastSuccessAt: snapshot.lastSuccessAt,
    }),
  );
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);

    try {
      return await handleApi(request, env);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "request failed",
          path: pathname,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return jsonResponse({ error: "Internal Server Error" }, 500);
    }
  },

  async scheduled(controller, env, ctx): Promise<void> {
    ctx.waitUntil(runScheduledRefresh(controller, env));
  },
} satisfies ExportedHandler<Env>;
