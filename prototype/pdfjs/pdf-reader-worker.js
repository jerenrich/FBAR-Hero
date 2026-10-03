// This worker never renders imported content or executes PDF scripts.
importScripts('/vendor/pdf-lib.js');
const writer=import('/xfa-packet-writer.mjs');
const streamLimit=16*1024*1024,totalLimit=64*1024*1024;
const objectLimit=100_000,objectDataLimit=32*1024*1024,textLimit=1024*1024,depthLimit=64;
const poolObjectLimit=100_000,poolDataLimit=16*1024*1024;
let allocated=0,objectData=0,objectCount=0,objectDepth=0;
let poolObjectCount=0,poolData=0,poolExceeded=false;
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
// The decoder budget alone cannot bound the object graph: pdf-lib accepts
// repeated ObjStm offsets and creates a separate string/array/dictionary for
// each entry. These adapters cover the pinned 1.17.1 parser before allocations.
// Count nodes (including dictionary keys), copied stream bytes and conservative
// text storage separately from decoded buffers. A bounded worker remains the
// final time limit for malformed input; no parser objects leave this worker.
const objectParser=PDFLib.PDFObjectParser.prototype;
const objectStreams=PDFLib.PDFObjectStreamParser.prototype;
const xrefs=PDFLib.PDFXRefStreamParser.prototype;
const xrefSections=PDFLib.PDFCrossRefSection.prototype;
const baseParser=Object.getPrototypeOf(objectParser);
const probe=PDFLib.PDFObjectParser.forBytes(new Uint8Array(),PDFLib.PDFContext.create());
const byteStream=Object.getPrototypeOf(probe.bytes);
for(const [target,methods] of [[objectParser,['parseObject','parseString','parseHexString','parseName']],
  [objectStreams,['parseIntoContext','parseOffsetsAndObjectNumbers']],
  [xrefs,['parseEntries']],[xrefSections,['addEntry','addDeletedEntry']],
  [baseParser,['parseRawInt','parseRawNumber']],[byteStream,['slice']]])
  if(methods.some(name=>typeof target[name]!=='function'))throw Error('Unsupported PDF parser');
function chargeObjects(count=1){
  if(!Number.isSafeInteger(count)||count<0||objectCount+count>objectLimit)
    throw Error('PDF object complexity exceeds the supported size limit.');
  chargeData(count*128);objectCount+=count;
}
function chargeData(size){
  if(!Number.isSafeInteger(size)||size<0||objectData+size>objectDataLimit)
    throw Error('PDF parsed data exceeds the supported size limit.');
  objectData+=size;
}
// pdf-lib interns names and references in module-level pools. Those survive
// between imports in the warmed worker, so bound new keys for its full lifetime.
// Reusing a key does not consume another allowance. At the limit the caller
// replaces this worker, preserving the editor draft and releasing both pools.
function chargePool(keys,key){
  if(keys.has(key))return;
  const size=128+key.length*8;
  if(poolObjectCount+1>poolObjectLimit||poolData+size>poolDataLimit){
    poolExceeded=true;throw Error('PDF parser cache exceeds the supported size limit. Retry the file to restart the reader.');
  }
  poolObjectCount++;poolData+=size;keys.add(key);
}
const pooledNames=new Set(),pooledRefs=new Set();
const nameOf=PDFLib.PDFName.of,refOf=PDFLib.PDFRef.of;
PDFLib.PDFName.of=function(name){
  // Match the pinned library's decoding so escaped spellings share one key.
  const key=name.replace(/#([\dABCDEF]{2})/g,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
  chargePool(pooledNames,key);return nameOf.call(this,name);
};
PDFLib.PDFRef.of=function(objectNumber,generationNumber=0){
  chargePool(pooledRefs,`${objectNumber} ${generationNumber} R`);
  return refOf.call(this,objectNumber,generationNumber);
};
const parseObject=objectParser.parseObject;
objectParser.parseObject=function(){
  chargeObjects();
  if(objectDepth>=depthLimit)throw Error('PDF objects are nested too deeply.');
  objectDepth++;
  try{return parseObject.call(this);}finally{objectDepth--;}
};
const slice=byteStream.slice;
byteStream.slice=function(start,end){
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>this.length)
    throw Error('Invalid PDF object data bounds.');
  chargeData(end-start);return slice.call(this,start,end);
};
// Scan without concatenating first. Building long strings one byte at a time
// can consume far more memory than their source length. Convert bounded chunks
// only after charging their storage, preserving every PDF byte (also 128..255).
function text(parser,start,end){
  const length=end-start;
  if(length>textLimit)throw Error('PDF text exceeds the supported size limit.');
  chargeData(length*8);
  const chunks=[];
  for(let offset=start;offset<end;offset+=8192)
    chunks.push(String.fromCharCode(...parser.bytes.bytes.subarray(offset,Math.min(offset+8192,end))));
  return chunks.join('');
}
objectParser.parseString=function(){
  const start=this.bytes.offset();let offset=start,nesting=0,escaped=false;
  while(offset<this.bytes.length){
    const byte=this.bytes.peekAt(offset++);
    if(offset-start>textLimit+2)throw Error('PDF text exceeds the supported size limit.');
    if(!escaped){if(byte===40)nesting++;else if(byte===41)nesting--;}
    if(byte===92)escaped=!escaped;else if(escaped)escaped=false;
    if(nesting===0){
      const value=text(this,start+1,offset-1);this.bytes.moveTo(offset);
      return PDFLib.PDFString.of(value);
    }
  }
  throw Error('Invalid unterminated PDF string.');
};
objectParser.parseHexString=function(){
  const start=this.bytes.offset()+1;let end=start;
  while(end<this.bytes.length&&this.bytes.peekAt(end)!==62){
    if(end-start>=textLimit)throw Error('PDF text exceeds the supported size limit.');
    end++;
  }
  if(end===this.bytes.length)throw Error('Invalid unterminated PDF hex string.');
  const value=text(this,start,end);this.bytes.moveTo(end+1);return PDFLib.PDFHexString.of(value);
};
const parseName=objectParser.parseName;
const delimiters=new Set([0,9,10,12,13,32,40,41,60,62,91,93,123,125,47,37]);
objectParser.parseName=function(){
  chargeObjects();let end=this.bytes.offset()+1;
  while(end<this.bytes.length&&!delimiters.has(this.bytes.peekAt(end))){
    if(end-this.bytes.offset()>1024)throw Error('PDF name exceeds the supported size limit.');
    end++;
  }
  chargeData((end-this.bytes.offset())*8);return parseName.call(this);
};
for(const method of ['parseRawInt','parseRawNumber']){
  const parse=baseParser[method];
  baseParser[method]=function(){
    let end=this.bytes.offset();
    while(end<this.bytes.length){
      const byte=this.bytes.peekAt(end);
      if(!(byte>=48&&byte<=57)&&!(method==='parseRawNumber'&&[43,45,46].includes(byte)))break;
      if(++end-this.bytes.offset()>32)throw Error('PDF number exceeds the supported size limit.');
    }
    return parse.call(this);
  };
}
objectStreams.parseIntoContext=async function(){
  if(this.alreadyParsed)throw Error('PDF object stream was already parsed.');
  this.alreadyParsed=true;
  if(!Number.isSafeInteger(this.objectCount)||this.objectCount<1||this.objectCount>objectLimit||
    !Number.isSafeInteger(this.firstOffset)||this.firstOffset<0||this.firstOffset>=this.bytes.length)
    throw Error('Invalid PDF object stream header.');
  // Charge the offset table before pdf-lib creates its array of entry objects.
  chargeObjects(this.objectCount);
  const decoded=this.bytes.bytes,ByteStream=this.bytes.constructor;
  if(typeof ByteStream.of!=='function')throw Error('Unsupported PDF byte stream');
  this.bytes=ByteStream.of(decoded.subarray(0,this.firstOffset));
  const entries=this.parseOffsetsAndObjectNumbers();
  this.skipWhitespaceAndComments();
  if(!this.bytes.done())throw Error('Invalid PDF object stream header bounds.');
  const ordered=entries.slice().sort((a,b)=>a.offset-b.offset),numbers=new Set(),ends=new Map();
  for(let index=0;index<ordered.length;index++){
    const entry=ordered[index],next=ordered[index+1];
    if(!Number.isSafeInteger(entry.objectNumber)||entry.objectNumber<1||numbers.has(entry.objectNumber)||
      !Number.isSafeInteger(entry.offset)||entry.offset<0||this.firstOffset+entry.offset>=decoded.length||
      (next&&next.offset<=entry.offset))
      throw Error('Invalid duplicate or overlapping PDF object stream offsets.');
    numbers.add(entry.objectNumber);ends.set(entry.offset,next?this.firstOffset+next.offset:decoded.length);
  }
  for(const {objectNumber,offset} of entries){
    // A bounded view prevents a string or container from consuming the next
    // entry. Reject overlap before allocating the first overlapping payload.
    this.bytes=ByteStream.of(decoded.subarray(this.firstOffset+offset,ends.get(offset)));
    const object=this.parseObject();this.skipWhitespaceAndComments();
    if(!this.bytes.done()||object instanceof PDFLib.PDFRawStream)
      throw Error('Invalid overlapping PDF object stream contents.');
    this.context.assign(PDFLib.PDFRef.of(objectNumber,0),object);
    if(this.shouldWaitForTick())await new Promise(resolve=>setTimeout(resolve,0));
  }
};
const parseEntries=xrefs.parseEntries;
xrefs.parseEntries=function(){
  const widths=this.byteWidths;
  if(widths.length!==3||widths.some(width=>!Number.isSafeInteger(width)||width<0||width>8)||
    widths.reduce((sum,width)=>sum+width,0)===0)throw Error('Invalid PDF cross reference widths.');
  let count=0;
  for(const {firstObjectNumber,length} of this.subsections){
    if(!Number.isSafeInteger(firstObjectNumber)||firstObjectNumber<0||!Number.isSafeInteger(length)||length<0||
      !Number.isSafeInteger(firstObjectNumber+length))throw Error('Invalid PDF cross reference bounds.');
    count+=length;
  }
  if(count*widths.reduce((sum,width)=>sum+width,0)>this.bytes.length)
    throw Error('Invalid PDF cross reference data length.');
  chargeObjects(count);return parseEntries.call(this);
};
for(const method of ['addEntry','addDeletedEntry']){
  const add=xrefSections[method];
  xrefSections[method]=function(...args){chargeObjects();return add.apply(this,args);};
}
self.onmessage=async({data:bytes})=>{
  allocated=0;objectData=0;objectCount=0;objectDepth=0;poolExceeded=false;
  try{
    const {inspectXfa}=await writer;
    const {pdf,packets}=await inspectXfa(PDFLib,bytes,{packetNames:new Set(['template','datasets','form']),strict:true});
    const result=Object.create(null);
    for(const [name,packet] of Object.entries(packets)){
      if(packet.bytes.byteLength>streamLimit)throw Error('PDF packet exceeds the supported size limit.');
      // Do not expose the untrusted PDF object graph or references to the editor.
      result[name]={bytes:packet.bytes.slice()};
    }
    const stateRef=pdf.catalog.get(PDFLib.PDFName.of('FBARWorkState'));
    if(stateRef){
      if(!(stateRef instanceof PDFLib.PDFRef))throw Error('Invalid saved work details');
      const state=PDFLib.decodePDFRawStream(pdf.context.lookup(stateRef)).decode();
      if(state.byteLength>2_000_000)throw Error('Saved work details exceed the supported size limit');
      result.workState={bytes:state.slice()};
    }
    self.postMessage({packets:result},Object.values(result).map(packet=>packet.bytes.buffer));
  }catch(error){self.postMessage({error:poolExceeded?'PDF parser cache exceeds the supported size limit. Retry the file to restart the reader.':error.message||'Unsupported PDF.',recycle:poolExceeded});}
};
