// Shared public boundary for the loopback server and the Pages build.
const assets = new Set([
  '/pdfjs/index.html', '/pdfjs/bootstrap.js', '/pdfjs/app.mjs', '/pdfjs/data-model.mjs',
  '/pdfjs/pdf-reader.mjs', '/pdfjs/pdf-reader-worker.js', '/pdfjs/field-catalog.json',
  '/xfa-packet-writer.mjs', '/fixtures/official-blank.pdf',
  ...[1, 3, 20].map(n => `/fixtures/datasets-${n}.xml`),
]);
const vendorFiles = new Set([
  '/build/pdf.mjs', '/build/pdf.worker.mjs', '/build/pdf.sandbox.mjs',
  '/web/pdf_viewer.css', '/web/pdf_viewer.mjs',
]);
const vendorResource = /^\/(?:cmaps\/[A-Za-z0-9_-]+\.bcmap|standard_fonts\/[A-Za-z0-9_-]+\.(?:pfb|ttf)|wasm\/[A-Za-z0-9_-]+\.(?:wasm|js))$/;
const securityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' blob: data:; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
};
module.exports = { assets, vendorFiles, vendorResource, securityHeaders };
