/**
 * store.rg-adguard.net 抓取 & HTML 解析。
 * 纯 fetch 实现,可在 Cloudflare Workers / Pages Functions 中运行。
 */

const RG_ADGUARD_ENDPOINT = "https://store.rg-adguard.net/api/GetFiles";
const CODEX_STORE_URL =
  "https://apps.microsoft.com/detail/9plm9xgg6vks?hl=zh-CN&gl=GB";

export interface CodexFile {
  fileName: string;
  version: string;
  arch: "x64" | "arm64";
  size: string;
  sha1: string;
  expire: string;
  url: string;
}

export interface CodexLinks {
  x64: CodexFile | null;
  arm64: CodexFile | null;
  fetchedAt: string;
  source: string;
}

export interface LinksSnapshot {
  status: "success" | "error";
  data: CodexLinks | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextRefreshAt: string | null;
}

/** 抓取 rg-adguard 并解析 msix 链接 */
export async function fetchCodexLinks(): Promise<CodexLinks> {
  const body = new URLSearchParams({
    type: "url",
    url: CODEX_STORE_URL,
    ring: "Retail",
    lang: "en-US",
  }).toString();

  const resp = await fetch(RG_ADGUARD_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://store.rg-adguard.net",
      Referer: "https://store.rg-adguard.net/",
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `rg-adguard 返回 HTTP ${resp.status},body: ${text.slice(0, 200)}`,
    );
  }

  const html = await resp.text();
  const files = parseTable(html);
  const x64 = files.find((f) => f.arch === "x64") || null;
  const arm64 = files.find((f) => f.arch === "arm64") || null;

  if (!x64 && !arm64) {
    throw new Error(
      `未从响应中解析到 msix 链接,页面片段:${html.slice(0, 500)}`,
    );
  }

  return {
    x64,
    arm64,
    fetchedAt: new Date().toISOString(),
    source: "https://store.rg-adguard.net/",
  };
}

function parseTable(html: string): CodexFile[] {
  const files: CodexFile[] = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const linkRegex =
    /<a[^>]*href=(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/i;

  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(html))) {
    const rowInner = match[1];
    const linkMatch = linkRegex.exec(rowInner);
    if (!linkMatch) continue;

    const url = (linkMatch[1] || linkMatch[2] || "").trim();
    const fileName = stripTags(linkMatch[3]).trim();
    if (!/\.msix$/i.test(fileName)) continue;

    const cells: string[] = [];
    const tdIter = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdIter.exec(rowInner))) {
      cells.push(stripTags(tdMatch[1]).trim());
    }
    if (cells.length < 4) continue;

    const arch = inferArch(fileName);
    if (!arch) continue;
    const version = inferVersion(fileName);

    files.push({
      fileName,
      version,
      arch,
      expire: cells[1] || "",
      sha1: cells[2] || "",
      size: cells[3] || "",
      url,
    });
  }
  return files;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

function inferArch(fileName: string): "x64" | "arm64" | null {
  if (/_x64_/i.test(fileName)) return "x64";
  if (/_arm64_/i.test(fileName)) return "arm64";
  return null;
}

function inferVersion(fileName: string): string {
  const m = /_(\d+\.\d+\.\d+\.\d+)_/.exec(fileName);
  return m ? m[1] : "";
}

/* ==================== KV 交互 ==================== */

const KV_KEY_SNAPSHOT = "snapshot";
const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 固定 10 分钟

/** Cloudflare 里的 KV 类型(避免依赖 workers-types 时也能编译) */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

export async function readSnapshot(
  kv: KVLike,
): Promise<LinksSnapshot | null> {
  const raw = await kv.get(KV_KEY_SNAPSHOT);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LinksSnapshot;
  } catch {
    return null;
  }
}

export async function writeSnapshot(
  kv: KVLike,
  snap: LinksSnapshot,
): Promise<void> {
  await kv.put(KV_KEY_SNAPSHOT, JSON.stringify(snap));
}

/** 下次抓取时间(固定 10 分钟后) */
export function computeNextRefreshAt(now = Date.now()): string {
  return new Date(now + REFRESH_INTERVAL_MS).toISOString();
}

/** 执行一次抓取,合并到旧快照(失败时保留旧数据),写回 KV,返回最新快照 */
export async function refreshAndPersist(
  kv: KVLike,
  prev?: LinksSnapshot | null,
): Promise<LinksSnapshot> {
  const attemptAt = new Date().toISOString();
  let snap: LinksSnapshot;
  try {
    const data = await fetchCodexLinks();
    snap = {
      status: "success",
      data,
      lastError: null,
      lastAttemptAt: attemptAt,
      lastSuccessAt: data.fetchedAt,
      nextRefreshAt: computeNextRefreshAt(),
    };
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    const base = prev ?? (await readSnapshot(kv));
    snap = {
      status: base?.data ? "success" : "error",
      data: base?.data ?? null,
      lastError: msg,
      lastAttemptAt: attemptAt,
      lastSuccessAt: base?.lastSuccessAt ?? null,
      nextRefreshAt: computeNextRefreshAt(),
    };
  }
  await writeSnapshot(kv, snap);
  return snap;
}

