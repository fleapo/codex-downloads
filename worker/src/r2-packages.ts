import type { CodexFile, CodexLinks } from "./rg-adguard";

const PACKAGE_PREFIX = "packages/";
const SHA1_PATTERN = /^[a-f0-9]{40}$/i;
const MSIX_CONTENT_TYPE = "application/vnd.ms-appx";

function normalizedSha1(sha1: string): string {
  const value = sha1.trim().toLowerCase();
  if (!SHA1_PATTERN.test(value)) {
    throw new Error(`无效的 SHA-1: ${sha1}`);
  }
  return value;
}

function validateSourceUrl(value: string): URL {
  const url = new URL(value);
  const microsoftHost =
    url.hostname === "delivery.mp.microsoft.com" ||
    url.hostname.endsWith(".delivery.mp.microsoft.com");

  if (!microsoftHost || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error(`拒绝镜像非 Microsoft 下载地址: ${url.hostname}`);
  }

  return url;
}

export function packageObjectKey(sha1: string): string {
  return `${PACKAGE_PREFIX}${normalizedSha1(sha1)}.msix`;
}

export function packageDownloadPath(file: CodexFile): string {
  return `/download/${normalizedSha1(file.sha1)}/${encodeURIComponent(file.fileName)}`;
}

export function isMirroredFile(file: CodexFile | null): boolean {
  return file === null || file.url === packageDownloadPath(file);
}

export function isMirroredLinks(
  links: CodexLinks | null | undefined,
): links is CodexLinks {
  return Boolean(
    links && isMirroredFile(links.x64) && isMirroredFile(links.arm64),
  );
}

async function mirrorPackage(
  bucket: R2Bucket,
  file: CodexFile,
): Promise<CodexFile> {
  const sha1 = normalizedSha1(file.sha1);
  const key = packageObjectKey(sha1);
  const existing = await bucket.head(key);

  if (!existing || existing.size === 0) {
    const sourceUrl = validateSourceUrl(file.sourceUrl || file.url);
    const response = await fetch(sourceUrl, {
      headers: {
        Accept: "application/octet-stream",
        "Accept-Encoding": "identity",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
    });

    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(
        `下载 ${file.fileName} 失败: HTTP ${response.status}`,
      );
    }

    await bucket.put(key, response.body, {
      // R2 在写入时校验上游提供的 SHA-1，校验失败不会发布对象。
      sha1,
      httpMetadata: {
        contentType: response.headers.get("content-type") || MSIX_CONTENT_TYPE,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        fileName: file.fileName,
        arch: file.arch,
        version: file.version,
        sha1,
      },
    });
  }

  return {
    ...file,
    sha1,
    sourceUrl: sourceUrlFor(file),
    url: packageDownloadPath(file),
  };
}

function sourceUrlFor(file: CodexFile): string {
  return file.sourceUrl || file.url;
}

export async function mirrorPackages(
  bucket: R2Bucket,
  links: CodexLinks,
): Promise<CodexLinks> {
  const [x64, arm64] = await Promise.all([
    links.x64 ? mirrorPackage(bucket, links.x64) : null,
    links.arm64 ? mirrorPackage(bucket, links.arm64) : null,
  ]);

  return { ...links, x64, arm64 };
}

function objectKeys(links: CodexLinks | null | undefined): string[] {
  if (!links) return [];
  return [links.x64, links.arm64]
    .filter((file): file is CodexFile => file !== null)
    .map((file) => packageObjectKey(file.sha1));
}

/** 保留当前版本和上一版本，避免旧页面或断点续传立即失效。 */
export async function cleanupPackages(
  bucket: R2Bucket,
  current: CodexLinks,
  previous?: CodexLinks | null,
): Promise<void> {
  const keep = new Set([...objectKeys(current), ...objectKeys(previous)]);
  let cursor: string | undefined;

  do {
    const listed = await bucket.list({ prefix: PACKAGE_PREFIX, cursor });
    const stale = listed.objects
      .map((object) => object.key)
      .filter((key) => !keep.has(key));

    if (stale.length > 0) {
      await bucket.delete(stale);
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

function attachmentHeader(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function responseHeaders(object: R2Object, fileName: string): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("content-disposition", attachmentHeader(fileName));
  headers.set("x-content-type-options", "nosniff");
  headers.set("access-control-allow-origin", "*");
  if (!headers.has("content-type")) {
    headers.set("content-type", MSIX_CONTENT_TYPE);
  }
  return headers;
}

function applyRangeHeaders(
  headers: Headers,
  range: R2Range,
  totalSize: number,
): void {
  let offset: number;
  let length: number;

  if ("suffix" in range) {
    length = Math.min(range.suffix, totalSize);
    offset = totalSize - length;
  } else {
    offset = range.offset ?? 0;
    length = Math.min(range.length ?? totalSize - offset, totalSize - offset);
  }

  headers.set("content-length", String(length));
  headers.set(
    "content-range",
    `bytes ${offset}-${offset + length - 1}/${totalSize}`,
  );
}

function parseDownloadPath(pathname: string): {
  key: string;
  fileName: string;
} | null {
  const match = /^\/download\/([a-f0-9]{40})\/([^/]+)$/i.exec(pathname);
  if (!match) return null;

  let fileName: string;
  try {
    fileName = decodeURIComponent(match[2]);
  } catch {
    return null;
  }

  if (!fileName || /[/\\]/.test(fileName) || !/\.msix$/i.test(fileName)) {
    return null;
  }

  return { key: packageObjectKey(match[1]), fileName };
}

export async function servePackage(
  request: Request,
  bucket: R2Bucket,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }

  const parsed = parseDownloadPath(new URL(request.url).pathname);
  if (!parsed) return new Response("Not Found", { status: 404 });

  if (request.method === "HEAD") {
    const object = await bucket.head(parsed.key);
    if (!object) return new Response("Not Found", { status: 404 });

    const storedName = object.customMetadata?.fileName;
    const headers = responseHeaders(object, storedName || parsed.fileName);
    headers.set("content-length", String(object.size));
    return new Response(null, { status: 200, headers });
  }

  const object = await bucket.get(parsed.key, {
    onlyIf: request.headers,
    range: request.headers,
  });
  if (!object) return new Response("Not Found", { status: 404 });

  const storedName = object.customMetadata?.fileName;
  const headers = responseHeaders(object, storedName || parsed.fileName);
  if (!("body" in object)) {
    const notModified =
      request.headers.has("if-none-match") ||
      request.headers.has("if-modified-since");
    return new Response(null, {
      status: notModified ? 304 : 412,
      headers,
    });
  }

  if (object.range) {
    applyRangeHeaders(headers, object.range, object.size);
  } else {
    headers.set("content-length", String(object.size));
  }

  return new Response(object.body, {
    status: object.range ? 206 : 200,
    headers,
  });
}
