const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const dist=process.env.FBAR_PDFJS_DIST || path.dirname(require.resolve('pdfjs-dist/package.json'));
const lib=require.resolve('pdf-lib/dist/pdf-lib.min.js');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.pdf':'application/pdf','.xml':'application/xml','.json':'application/json','.wasm':'application/wasm','.ttf':'font/ttf'};
// Only application assets are public. Never expose arbitrary files in fixtures,
// source directories, or results (which may contain sensitive local documents).
const {assets,vendorFiles,vendorResource,securityHeaders}=require('../asset-manifest.cjs');
function createServer(){return http.createServer((req,res)=>{
  const allowed=new Set([`127.0.0.1:${req.socket.localPort}`,`localhost:${req.socket.localPort}`]);
  if(!allowed.has(req.headers.host)){res.writeHead(403);res.end();return;}
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  let name,base=root,file;
  try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}
  catch{res.writeHead(400);res.end();return;}
  if(name.includes('\0')){res.writeHead(400);res.end();return;}
  // Decode before checking path components; URL parsing alone does not remove
  // dot segments containing an encoded slash. Do not normalize these into assets.
  if(name.includes('\\')||name.split('/').some(p=>p==='.'||p==='..')){res.writeHead(403);res.end();return;}
  if(name==='/')name='/pdfjs/index.html';
  if(name==='/bootstrap.js')name='/pdfjs/bootstrap.js';
  if(name.startsWith('/vendor/pdfjs/')){
    base=dist;name=name.slice('/vendor/pdfjs'.length);
    if(!vendorFiles.has(name)&&!vendorResource.test(name)){res.writeHead(404);res.end();return;}
  }
  else if(name==='/vendor/pdf-lib.js'){base=path.dirname(lib);name='/'+path.basename(lib);}
  else if(!assets.has(name)){res.writeHead(404);res.end();return;}
  file=path.resolve(base,'.'+name);
  if(!file.startsWith(path.resolve(base)+path.sep)){res.writeHead(403);res.end();return;}
  // Resolve every component to prevent symlinks from escaping the selected
  // asset root. Reject a linked final file as well, including links within root.
  fs.realpath(file,(error,realFile)=>{
    if(error){res.writeHead(404);res.end();return;}
    let realBase;
    try{realBase=fs.realpathSync(base);}catch{res.writeHead(404);res.end();return;}
    if(realFile!==path.join(realBase,name.slice(1))){res.writeHead(403);res.end();return;}
    fs.readFile(realFile,(error,data)=>{
      if(error){res.writeHead(404);res.end();return;}
      res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream',...securityHeaders});res.end(data);
    });
  });
});}
module.exports={createServer};
if(require.main===module)createServer().listen(3141,'127.0.0.1',()=>console.log('FBAR Magician: http://127.0.0.1:3141'));
