export const PUBLIC_FILES: ReadonlySet<string> = new Set([
  'intraday.js',
  'news-media.js',
  'split-reader.js',
  'feed.js',
  'home-feed.js',
  'feed.css',
  'live-quotes.js',
  'global.js',
  'global-pages.js',
  'desk.js',
  'desk-pages.js',
  'ui.js',
  'reading.js',
  'reading-pages.js',
  'market-context.js',
  'context-pages.js',
  'events.js',
  'event-pages.js',
  'index.html',
  'style.css',
  'brief.js',
  'topics.js',
  'topic-pages.js',
  'calendar.js',
  'calendar-pages.js',
  'health-pages.js',
  'home.js',
  'app.js',
  'pages.js',
  'reader.js',
  'technical.js',
  'analysis-pages.js',
  'data/dashboard.json',
  'rail/index.html',
]);

export interface ResolvedRoute {
  kind: 'file' | 'redirect' | 'rail-city-bridge';
  target: string;
  cacheControl: string;
}

export function resolvePublicRoute(rawPathname: string): ResolvedRoute | null {
  if (!rawPathname || !rawPathname.startsWith('/')) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPathname);
  } catch {
    return null;
  }

  if (decoded.includes('\0') || decoded.includes('\\') || decoded.includes('..')) {
    return null;
  }

  if (decoded === '/') {
    return {
      kind: 'file',
      target: 'index.html',
      cacheControl: 'no-cache',
    };
  }

  if (decoded === '/rail') {
    return {
      kind: 'redirect',
      target: '/rail/',
      cacheControl: 'no-cache',
    };
  }

  if (decoded === '/rail/') {
    return {
      kind: 'file',
      target: 'rail/index.html',
      cacheControl: 'no-cache',
    };
  }

  if (decoded === '/rail-city' || decoded === '/rail-city/') {
    return {
      kind: 'rail-city-bridge',
      target: 'https://xxbo.github.io/rail-city/',
      cacheControl: 'no-cache',
    };
  }

  const relativePath = decoded.replace(/^\/+/, '');
  if (!PUBLIC_FILES.has(relativePath)) {
    return null;
  }

  const cacheControl =
    relativePath === 'data/dashboard.json' || relativePath.endsWith('.html')
      ? 'no-cache, no-store, must-revalidate'
      : 'public, max-age=0, must-revalidate';

  return {
    kind: 'file',
    target: relativePath,
    cacheControl,
  };
}
