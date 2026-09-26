const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const dist=process.env.FBAR_PDFJS_DIST || path.dirname(require.resolve('pdfjs-dist/package.json'));
const lib=require.resolve('pdf-lib/dist/pdf-lib.min.js');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.pdf':'application/pdf','.xml':'application/xml','.wasm':'application/wasm','.ttf':'font/ttf'};
function createServer(){return http.createServer((req,res)=>{
  const allowed=new Set([`127.0.0.1:${req.socket.localPort}`,`localhost:${req.socket.localPort}`]);
  if(!allowed.has(req.headers.host)){res.writeHead(403);res.end();return;}
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  let name,base=root,file;
  try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}
  catch{res.writeHead(400);res.end();return;}
  if(name.includes('\0')){res.writeHead(400);res.end();return;}
  if(name==='/')name='/pdfjs/index.html';
  if(name==='/bootstrap.js')name='/pdfjs/bootstrap.js';
  if(name.startsWith('/vendor/pdfjs/')){base=dist;name=name.slice('/vendor/pdfjs'.length);}
  else if(name==='/vendor/pdf-lib.js'){base=path.dirname(lib);name='/'+path.basename(lib);}
  else if(!/^\/(pdfjs\/|fixtures\/|xfa-packet-writer\.mjs$)/.test(name)){res.writeHead(404);res.end();return;}
  file=path.resolve(base,'.'+name);
  if(!file.startsWith(path.resolve(base)+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,data)=>{
    if(error){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' blob: data:; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(data);
  });
});}
module.exports={createServer};
if(require.main===module)createServer().listen(3141,'127.0.0.1',()=>console.log('FBAR Magician: http://127.0.0.1:3141'));
