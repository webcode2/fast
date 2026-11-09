// Local preview only. Video seeking needs range requests, which simple static servers skip.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const root = import.meta.dirname;
const port = Number(process.env.PORT ?? 8092);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mp4': 'video/mp4', '.jpg': 'image/jpeg' };

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://local').pathname);
  const file = resolve(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
    return response.writeHead(404).end('Not found');
  }
  const { size } = statSync(file);
  const headers = { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end) return response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return createReadStream(file, { start, end }).pipe(response);
  }
  response.writeHead(200, { ...headers, 'Content-Length': size });
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`Landing page at http://127.0.0.1:${port}`));
