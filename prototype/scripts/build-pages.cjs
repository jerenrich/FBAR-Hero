const fs = require('node:fs');
const path = require('node:path');
const { assets, vendorFiles, vendorResource, securityHeaders } = require('../asset-manifest.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const pdfjs = path.dirname(require.resolve('pdfjs-dist/package.json'));
const pdfLib = path.dirname(require.resolve('pdf-lib/package.json'));

// Always rebuild an isolated directory. Never publish the repository or fixtures
// directory wholesale: local working files and QA results are not web assets.
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
let count = 0;
function copy(base, relative, destination = relative) {
  const realBase = fs.realpathSync(base);
  const source = path.join(realBase, relative);
  if (fs.realpathSync(source) !== source || !fs.lstatSync(source).isFile()) {
    throw new Error(`Not a regular public asset: ${relative}`);
  }
  if (fs.statSync(source).size > 25 * 1024 * 1024) throw new Error(`Pages asset too large: ${relative}`);
  const target = path.join(output, destination);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  count++;
}
for (const asset of assets) copy(root, asset.slice(1));
copy(root, 'pdfjs/index.html', 'index.html');
copy(root, 'pdfjs/bootstrap.js', 'bootstrap.js');
copy(pdfLib, 'dist/pdf-lib.min.js', 'vendor/pdf-lib.js');
copy(pdfLib, 'LICENSE.md', 'vendor/pdf-lib-LICENSE.md');
for (const file of vendorFiles) copy(pdfjs, file.slice(1), `vendor/pdfjs${file}`);
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  for (const name of fs.readdirSync(path.join(pdfjs, directory))) {
    const relative = `${directory}/${name}`;
    if (vendorResource.test(`/${relative}`) || /^LICENSE(?:[A-Za-z0-9_.-]*)$/.test(name)) {
      copy(pdfjs, relative, `vendor/pdfjs/${relative}`);
    }
  }
}
copy(pdfjs, 'LICENSE', 'vendor/pdfjs/LICENSE');
fs.writeFileSync(path.join(output, '_headers'), '/*\n' + Object.entries(securityHeaders).map(([name, value]) => `  ${name}: ${value}\n`).join(''));
// A top-level 404 prevents Pages from serving the editor for missing/private paths.
fs.writeFileSync(path.join(output, '404.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>Page not found</title><h1>Page not found</h1><p><a href="/">Open FBAR Hero</a></p></html>\n');
console.log(`Built ${count + 2} public files in ${output}`);
