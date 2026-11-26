import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { resolvePublicRoute } from './src/server-routes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = '0.0.0.0';

app.disable('x-powered-by');

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).type('text/plain; charset=utf-8').send('Method Not Allowed');
    return;
  }

  const resolved = resolvePublicRoute(req.path);
  if (!resolved) {
    next();
    return;
  }

  res.setHeader('Cache-Control', resolved.cacheControl);

  if (resolved.kind === 'redirect') {
    const suffix = req.url.slice(req.path.length);
    res.redirect(302, resolved.target + suffix);
    return;
  }

  if (resolved.kind === 'rail-city-bridge') {
    res
      .status(200)
      .type('text/html; charset=utf-8')
      .send(
        `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>轨道都市 · 独立游戏站</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1.25rem;line-height:1.65;color:#182026}a{color:#0f52ba}</style></head><body><h1>轨道都市 · 游戏实验场</h1><p>轨道都市已迁移至独立仓库 <code>xxbo/rail-city</code> 独立部署。</p><p><a href="${resolved.target}" target="_blank" rel="noopener noreferrer">在新标签页打开线上版轨道都市 ↗</a> · <a href="/#/overview">返回观潮首页</a></p></body></html>`,
      );
    return;
  }

  res.sendFile(path.join(__dirname, resolved.target), (err) => {
    if (err && !res.headersSent) {
      next(err);
    }
  });
});

app.use((_req, res) => {
  res.status(404).type('text/plain; charset=utf-8').send('Not Found');
});

app.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});
