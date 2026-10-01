const fs=require('node:fs');
const path=require('node:path');
const PDFLib=require('pdf-lib');

module.exports=async function readSavedPdfWork(filePath){
 const bytes=fs.readFileSync(filePath),{inspectXfa}=await import('../xfa-packet-writer.mjs');
 const {pdf,packets}=await inspectXfa(PDFLib,bytes);
 const stateRef=pdf.catalog.get(PDFLib.PDFName.of('FBARWorkState'));
 const state=stateRef?JSON.parse(new TextDecoder().decode(PDFLib.decodePDFRawStream(pdf.context.lookup(stateRef)).decode())):null;
 return {format:'fbar-work-in-progress',version:1,synthetic:state?.synthetic??path.basename(filePath).startsWith('SYNTHETIC-'),
  datasets:new TextDecoder().decode(packets.datasets.bytes),institutions:state?.institutions,owners:state?.owners,priorBalances:state?.priorBalances};
};
