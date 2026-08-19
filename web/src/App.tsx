import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
}

interface CodexLinks {
  x64: CodexFile | null;
  arm64: CodexFile | null;
  fetchedAt: string;
  source: string;
}

interface LinksSnapshot {
  status: 'idle' | 'fetching' | 'success' | 'error';
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
  refresh: () => Promise<void>;
} {
  const [snap, setSnap] = useState<LinksSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const inflight = useRef(false);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setLoading(true);
    try {
      const res = await fetch('/api/links', { cache: 'no-store' });
      const data: LinksSnapshot = await res.json();
      setSnap(data);
    } catch (e) {
      setSnap((prev) =>
        prev
          ? { ...prev, lastError: (e as Error).message, status: 'error' }
          : {
              status: 'error',
              data: null,
              lastError: (e as Error).message,
              lastAttemptAt: null,
              lastSuccessAt: null,
              nextRefreshAt: null,
            },
      );
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setLoading(true);
    try {
      const res = await fetch('/api/links/refresh', { method: 'POST' });
      const data: LinksSnapshot = await res.json();
      setSnap(data);
    } catch (e) {
      setSnap((prev) =>
        prev ? { ...prev, lastError: (e as Error).message } : prev,
      );
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(load, 15000);
    return () => window.clearInterval(t);
  }, [load]);

  return { snap, loading, refresh };
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
  loading: boolean;
  onRefresh: () => void;
}

function fmtClock(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function StatusPill({ snap, loading, onRefresh }: StatusPillProps) {
  const clock = fmtClock(snap?.lastSuccessAt ?? null);

  return (
    <div className={`status-pill${loading ? ' status-fetching' : ''}`}>
      <span className="status-label">上次同步时间:{clock}</span>
      <button
        className="refresh-btn"
        onClick={onRefresh}
        aria-label="立即刷新"
        disabled={loading}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          <path
            d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 3v3h-3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </button>
    </div>
  );
}

function Hero({
  version,
  snap,
  loading,
  onRefresh,
}: {
  version: string;
  snap: LinksSnapshot | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className="hero">
      <StatusPill snap={snap} loading={loading} onRefresh={onRefresh} />

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
  const [copied, setCopied] = useState(false);
  const [pressed, setPressed] = useState(false);

  const meta = ARCH_META[arch];
  const disabled = !file;

  const onCopy = useCallback(async () => {
    if (!file) return;
    const ok = await copyText(file.url);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [file]);

  const onDownload = useCallback(() => {
    if (!file) return;
    setPressed(true);
    window.setTimeout(() => setPressed(false), 500);
    window.location.href = file.url;
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
        <MetaRow label="有效期">
          <span className="mono">{file?.expire || '—'}</span>
        </MetaRow>
      </div>

      <div className="card-actions">
        <button
          className={`btn btn-primary${pressed ? ' btn-pressed' : ''}`}
          disabled={disabled}
          onClick={onDownload}
        >
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
          <span>下载 .msix</span>
        </button>
        <button
          className={`btn btn-ghost${copied ? ' btn-copied' : ''}`}
          disabled={disabled}
          onClick={onCopy}
        >
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
          <span>{copied ? '已复制' : '复制链接'}</span>
        </button>
      </div>
    </article>
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
      <span>每 10 分钟自动同步(含 0–60 秒随机抖动)</span>
    </footer>
  );
}

/* ==================== 应用 ==================== */

function App() {
  const { snap, loading, refresh } = useLinks();

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
        <Hero
          version={version}
          snap={snap}
          loading={loading}
          onRefresh={refresh}
        />

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
              {snap.lastError || '请稍后重试,或点击右上角立即刷新。'}
            </div>
            <button className="btn btn-primary" onClick={refresh}>
              重试
            </button>
          </div>
        )}
      </main>
      <Footer snap={snap} />
    </div>
  );
}

export default App;
