import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

function safeJoin(root, requestPath) {
  const relative = decodeURIComponent(requestPath).replaceAll('\\', '/');
  if (relative.includes('..')) return null;
  const filePath = path.resolve(root, relative);
  const rootPath = path.resolve(root);
  if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${path.sep}`)) return null;
  return filePath;
}

export function startReviewServer({
  port = 4173,
  outputDir,
  documentsRoot,
  onDecide,
}) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);

      if (request.method === 'POST' && url.pathname === '/api/decide') {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        await onDecide(String(body.noticeId || ''), body.decision);
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"ok":true}');
        return;
      }

      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/review.html')) {
        const html = await readFile(path.join(outputDir, 'review.html'));
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(html);
        return;
      }

      if (request.method === 'GET' && url.pathname.startsWith('/documents/')) {
        const filePath = safeJoin(documentsRoot, url.pathname.slice('/documents/'.length));
        if (!filePath || !existsSync(filePath)) {
          response.writeHead(404);
          response.end('Not found');
          return;
        }
        response.writeHead(200);
        createReadStream(filePath).pipe(response);
        return;
      }

      if (request.method === 'GET') {
        const filePath = safeJoin(outputDir, url.pathname.replace(/^\//, ''));
        if (filePath && existsSync(filePath)) {
          response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          createReadStream(filePath).pipe(response);
          return;
        }
      }

      response.writeHead(404);
      response.end('Not found');
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error.message);
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
