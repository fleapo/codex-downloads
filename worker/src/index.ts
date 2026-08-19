import {
  readSnapshot,
  refreshAndPersist,
  type LinksSnapshot,
} from "./rg-adguard";
import { isMirroredLinks, servePackage } from "./r2-packages";

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
  const stored = await readSnapshot(env.CODEX_LINKS);
  if (stored && isMirroredLinks(stored.data)) return jsonResponse(stored);

  const snapshot: LinksSnapshot = {
    status: "error",
    data: null,
    lastError: "R2 镜像尚未生成，请等待下一次 Cron 完成后刷新页面。",
    lastAttemptAt: stored?.lastAttemptAt ?? null,
    lastSuccessAt: null,
    nextRefreshAt: stored?.nextRefreshAt ?? null,
  };

  return jsonResponse(snapshot);
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname === "/api/links") {
    return request.method === "GET"
      ? getLinks(env)
      : methodNotAllowed("GET");
  }

  if (pathname.startsWith("/download/")) {
    return servePackage(request, env.CODEX_PACKAGES);
  }

  return jsonResponse({ error: "Not Found" }, 404);
}

async function runScheduledRefresh(
  controller: ScheduledController,
  env: Env,
): Promise<void> {
  const previous = await readSnapshot(env.CODEX_LINKS);
  const snapshot = await refreshAndPersist(
    env.CODEX_LINKS,
    env.CODEX_PACKAGES,
    previous,
  );

  const log = {
    message: snapshot.lastError
      ? "scheduled refresh failed"
      : "scheduled refresh completed",
    cron: controller.cron,
    scheduledTime: controller.scheduledTime,
    status: snapshot.status,
    lastError: snapshot.lastError,
    lastSuccessAt: snapshot.lastSuccessAt,
  };

  if (snapshot.lastError) {
    console.error(JSON.stringify(log));
  } else {
    console.log(JSON.stringify(log));
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);

    try {
      return await handleRequest(request, env);
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
