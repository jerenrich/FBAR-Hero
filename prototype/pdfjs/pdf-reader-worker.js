// This worker never renders imported content or executes PDF scripts.
importScripts('/vendor/pdf-lib.js');
const writer=import('/xfa-packet-writer.mjs');
const streamLimit=16*1024*1024,totalLimit=64*1024*1024;
let allocated=0;
// pdf-lib 1.17.1 has no decompression budget. Its shared DecodeStream base is
// used by every filter, including chained filters, object streams and xrefs.
// Guard allocations BEFORE decode(), which can expand one block indefinitely.
// Keep this adapter covered when upgrading the pinned library. The patch exists
// only in this worker; the trusted-template writer uses its own library instance.
const sample=PDFLib.decodePDFRawStream(PDFLib.PDFContext.create().flateStream(new Uint8Array()));
const decoder=Object.getPrototypeOf(Object.getPrototypeOf(sample));
if(typeof decoder.ensureBuffer!=='function')throw Error('Unsupported PDF decoder');
const ensureBuffer=decoder.ensureBuffer;
decoder.ensureBuffer=function(requested){
  if(!Number.isSafeInteger(requested)||requested<0||requested>streamLimit)
    throw Error('PDF decompressed data exceeds the supported size limit.');
  let size=this.minBufferLength;
  while(size<requested)size*=2;
  const growth=Math.max(0,size-this.buffer.byteLength);
  if(size>streamLimit||allocated+growth>totalLimit)
    throw Error('PDF decompressed data exceeds the supported size limit.');
  allocated+=growth;
  return ensureBuffer.call(this,requested);
};
self.onmessage=async({data:bytes})=>{
  allocated=0;
  try{
    const {inspectXfa}=await writer;
    const {packets}=await inspectXfa(PDFLib,bytes,{packetNames:new Set(['template','datasets','form']),strict:true});
    const result=Object.create(null);
    for(const [name,packet] of Object.entries(packets)){
      if(packet.bytes.byteLength>streamLimit)throw Error('PDF packet exceeds the supported size limit.');
      // Do not expose the untrusted PDF object graph or references to the editor.
      result[name]={bytes:packet.bytes.slice()};
    }
    self.postMessage({packets:result},Object.values(result).map(packet=>packet.bytes.buffer));
  }catch(error){self.postMessage({error:error.message||'Unsupported PDF.'});}
};
