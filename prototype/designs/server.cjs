const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const files = {'/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/styles.css': ['styles.css', 'text/css'], '/app.js': ['app.js', 'text/javascript']};
const port = Number(process.env.PORT || 3142);
http.createServer((req, res) => {
  if (!['127.0.0.1:' + port, 'localhost:' + port].includes(req.headers.host)) { res.writeHead(403).end(); return; }
  const item = files[new URL(req.url, 'http://localhost').pathname];
  if (req.method !== 'GET' || !item) { res.writeHead(404).end(); return; }
  res.writeHead(200, {'Content-Type': item[1], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; connect-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
  res.end(fs.readFileSync(path.join(__dirname, item[0])));
}).listen(port, '127.0.0.1', () => console.log('Design prototypes: http://127.0.0.1:' + port));
