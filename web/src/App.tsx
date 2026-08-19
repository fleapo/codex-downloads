import { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';

/* ==================== 类型 ==================== */

interface CodexFile {
  fileName: string;
  version: string;
  arch: 'x64' | 'arm64';
  size: string;
  sha1: string;
  expire: string;
  url: string;
  sourceUrl?: string;
}

interface CodexLinks {
  x64: CodexFile | null;
  arm64: CodexFile | null;
  fetchedAt: string;
  source: string;
}

interface LinksSnapshot {
  status: 'success' | 'error';
  data: CodexLinks | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextRefreshAt: string | null;
}

/* ==================== Hooks ==================== */

function useLinks(): {
  snap: LinksSnapshot | null;
  loading: boolean;
} {
  const [snap, setSnap] = useState<LinksSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const res = await fetch('/api/links', { cache: 'no-store' });
        if (!res.ok) throw new Error(`请求失败 (${res.status})`);
        const data: LinksSnapshot = await res.json();
        if (active) setSnap(data);
      } catch (e) {
        if (!active) return;
        setSnap({
          status: 'error',
          data: null,
          lastError: (e as Error).message,
          lastAttemptAt: null,
          lastSuccessAt: null,
          nextRefreshAt: null,
        });
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return { snap, loading };
}

/* ==================== 工具函数 ==================== */

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallthrough */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function absoluteUrl(value: string): string {
  return new URL(value, window.location.origin).href;
}

/* ==================== 组件 ==================== */

function BrandMark() {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 32 32"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="bm-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a5b4fc" />
          <stop offset="1" stopColor="#34d399" />
        </linearGradient>
      </defs>
      <path
        d="M10 12 L6 16 L10 20 M22 12 L26 16 L22 20 M18 10 L14 22"
        stroke="url(#bm-g)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function Header() {
  return (
    <header className="header">
      <div className="brand">
        <BrandMark />
        <div className="brand-text">
          <span className="brand-name">Codex</span>
          <span className="brand-sub">for Windows</span>
        </div>
      </div>
      <a
        className="header-link"
        href="https://apps.microsoft.com/detail/9plm9xgg6vks"
        target="_blank"
        rel="noreferrer"
      >
        <span>Microsoft Store</span>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
          <path
            d="M3 3h6v6M3 9l6-6"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </a>
    </header>
  );
}

interface StatusPillProps {
  snap: LinksSnapshot | null;
}

function fmtClock(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function fmtLocalDateTime(value: string): string {
  if (!value) return '—';

  const gmt = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(
    value,
  );
  const date = gmt
    ? new Date(
        Date.UTC(
          Number(gmt[1]),
          Number(gmt[2]) - 1,
          Number(gmt[3]),
          Number(gmt[4]),
          Number(gmt[5]),
          Number(gmt[6]),
        ),
      )
    : new Date(value);

  if (!Number.isFinite(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(date);
}

function StatusPill({ snap }: StatusPillProps) {
  const clock = fmtClock(snap?.lastSuccessAt ?? null);

  return (
    <div className="status-pill">
      <span className="status-label">上次同步时间:{clock}</span>
    </div>
  );
}

function Hero({
  version,
  snap,
}: {
  version: string;
  snap: LinksSnapshot | null;
}) {
  return (
    <section className="hero">
      <StatusPill snap={snap} />

      <h1 className="hero-title">
        Codex <span className="accent">桌面版</span>
        <br />
        Windows 下载
      </h1>
      <p className="hero-desc">
        直接获取来自 Microsoft Store 的最新 <code>.msix</code> 安装包镜像。
        {version && (
          <>
            {' '}当前版本 <b className="hero-version">{version}</b>。
          </>
        )}
      </p>
    </section>
  );
}

interface DownloadCardProps {
  arch: 'x64' | 'arm64';
  file: CodexFile | null;
  loading: boolean;
}

function DownloadCard({ arch, file, loading }: DownloadCardProps) {
  const [copied, setCopied] = useState<'mirror' | 'source' | null>(null);
  const [pressed, setPressed] = useState<'mirror' | 'source' | null>(null);

  const meta = ARCH_META[arch];
  const disabled = !file;

  const onCopy = useCallback(async (target: 'mirror' | 'source') => {
    if (!file) return;
    const value = target === 'mirror' ? file.url : file.sourceUrl;
    if (!value) return;
    const ok = await copyText(absoluteUrl(value));
    if (!ok) return;
    setCopied(target);
    window.setTimeout(() => setCopied(null), 1600);
  }, [file]);

  const onDownload = useCallback((target: 'mirror' | 'source') => {
    if (!file) return;
    const value = target === 'mirror' ? file.url : file.sourceUrl;
    if (!value) return;
    setPressed(target);
    window.setTimeout(() => setPressed(null), 500);
    window.location.href = value;
  }, [file]);

  return (
    <article
      className={`card${disabled ? ' card-disabled' : ''}${
        loading ? ' card-loading' : ''
      }`}
    >
      <div className="card-glow" aria-hidden />
      <header className="card-head">
        <div className="card-title-wrap">
          <span className={`arch-badge arch-${arch}`}>{meta.label}</span>
          <h2 className="card-title">{meta.title}</h2>
        </div>
        <span className="card-hint">{meta.hint}</span>
      </header>

      <div className="card-meta">
        <MetaRow label="文件">
          <code className="mono ellipsis" title={file?.fileName}>
            {file?.fileName || '—'}
          </code>
        </MetaRow>
        <MetaRow label="大小">
          <span className="mono">{file?.size || '—'}</span>
        </MetaRow>
        <MetaRow label="SHA-1">
          <code className="mono ellipsis" title={file?.sha1}>
            {file?.sha1 || '—'}
          </code>
        </MetaRow>
        <MetaRow label="源链接到期">
          <span className="mono" title={file?.expire}>
            {file ? fmtLocalDateTime(file.expire) : '—'}
          </span>
        </MetaRow>
      </div>

      <div className="card-actions">
        <div className="action-row">
          <button
            className={`btn btn-primary${pressed === 'mirror' ? ' btn-pressed' : ''}`}
            disabled={disabled}
            onClick={() => onDownload('mirror')}
          >
            <DownloadIcon />
            <span>R2 安全下载</span>
          </button>
          <button
            className={`btn btn-ghost${copied === 'mirror' ? ' btn-copied' : ''}`}
            disabled={disabled}
            onClick={() => void onCopy('mirror')}
          >
            <CopyIcon copied={copied === 'mirror'} />
            <span>{copied === 'mirror' ? '已复制' : '复制 R2 链接'}</span>
          </button>
        </div>

        <div className="action-row action-row-source">
          <button
            className={`btn btn-source${pressed === 'source' ? ' btn-pressed' : ''}`}
            disabled={disabled || !file?.sourceUrl}
            onClick={() => onDownload('source')}
            title="原始 HTTP 链接可能触发浏览器安全提示"
          >
            <DownloadIcon />
            <span>原始 HTTP 下载</span>
          </button>
          <button
            className={`btn btn-ghost btn-source-copy${copied === 'source' ? ' btn-copied' : ''}`}
            disabled={disabled || !file?.sourceUrl}
            onClick={() => void onCopy('source')}
          >
            <CopyIcon copied={copied === 'source'} />
            <span>{copied === 'source' ? '已复制' : '复制原始链接'}</span>
          </button>
        </div>
        <div className="source-warning">原始 HTTP 链接可能被浏览器标记为不安全</div>
      </div>
    </article>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
      <path
        d="M8 2v9m0 0l-3.2-3.2M8 11l3.2-3.2M3 13.5h10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function CopyIcon({ copied }: { copied: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      {copied ? (
        <path
          d="M3 8.5l3 3 7-7"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ) : (
        <>
          <rect
            x="5"
            y="5"
            width="8"
            height="8"
            rx="1.6"
            stroke="currentColor"
            strokeWidth="1.4"
            fill="none"
          />
          <path
            d="M3 10V4a1 1 0 0 1 1-1h6"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            fill="none"
          />
        </>
      )}
    </svg>
  );
}

function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="meta-row">
      <span className="meta-label">{label}</span>
      <span className="meta-value">{children}</span>
    </div>
  );
}

const ARCH_META: Record<
  'x64' | 'arm64',
  { label: string; title: string; hint: string }
> = {
  x64: {
    label: 'x64',
    title: 'Intel / AMD 64-bit',
    hint: '适用于绝大多数 Windows 10/11 桌面与笔记本',
  },
  arm64: {
    label: 'arm64',
    title: 'ARM 64-bit',
    hint: '适用于 Snapdragon X、Surface Pro 等 ARM 设备',
  },
};

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="error-banner" role="alert">
      <span className="error-icon" aria-hidden>!</span>
      <div>
        <div className="error-title">最近一次同步失败,展示的是上次成功的结果</div>
        <div className="error-message">{message}</div>
      </div>
    </div>
  );
}

function Footer({ snap }: { snap: LinksSnapshot | null }) {
  return (
    <footer className="footer">
      <span>
        数据来源:{' '}
        <a
          href={snap?.data?.source || 'https://store.rg-adguard.net/'}
          target="_blank"
          rel="noreferrer"
        >
          store.rg-adguard.net
        </a>
      </span>
      <span className="dot" aria-hidden />
      <span>Cloudflare R2 镜像 · 每 10 分钟自动同步</span>
    </footer>
  );
}

/* ==================== 应用 ==================== */

function App() {
  const { snap, loading } = useLinks();

  const version = useMemo(() => {
    const f = snap?.data?.x64 || snap?.data?.arm64;
    return f?.version || '';
  }, [snap]);

  const hasError = snap?.status === 'error' && !snap.data;
  const softError = !!(snap?.lastError && snap?.data);

  return (
    <div className="app">
      <Header />
      <main className="main">
        <Hero version={version} snap={snap} />

        {softError && snap?.lastError && (
          <ErrorBanner message={snap.lastError} />
        )}

        <section className="cards">
          <DownloadCard
            arch="x64"
            file={snap?.data?.x64 ?? null}
            loading={loading && !snap?.data}
          />
          <DownloadCard
            arch="arm64"
            file={snap?.data?.arm64 ?? null}
            loading={loading && !snap?.data}
          />
        </section>

        {hasError && (
          <div className="empty-state">
            <div className="empty-title">暂时拿不到下载链接</div>
            <div className="empty-desc">
              {snap.lastError || '请等待下一次定时同步后刷新页面。'}
            </div>
          </div>
        )}
      </main>
      <Footer snap={snap} />
    </div>
  );
}

export default App;
