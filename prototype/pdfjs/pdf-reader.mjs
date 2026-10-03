// Parse untrusted PDFs away from the editor. A stalled parser can be terminated
// without losing the user's in-memory draft. Requests share a warmed worker so
// normal imports and comparisons continue to work after going offline.
let worker=null,queue=Promise.resolve();
const timeoutMs=15_000;
export function readPackets(bytes){
  if(bytes.byteLength>25_000_000)return Promise.reject(Error('Choose an FBAR PDF smaller than 25 MB.'));
  const copy=new Uint8Array(bytes);
  const result=queue.then(()=>new Promise((resolve,reject)=>{
    const current=worker||(worker=new Worker('/pdfjs/pdf-reader-worker.js'));
    const finish=(error,packets,discard=false)=>{
      clearTimeout(timer);current.onmessage=null;current.onerror=null;current.onmessageerror=null;
      if(discard){current.terminate();worker=null;}
      if(error)reject(error);else resolve(packets);
    };
    const timer=setTimeout(()=>finish(Error('PDF processing exceeded the time limit. Your current draft is unchanged.'),null,true),timeoutMs);
    current.onmessage=({data})=>data.error?finish(Error(data.error),null,data.recycle===true):finish(null,data.packets);
    current.onerror=event=>{event.preventDefault();finish(Error('The local PDF reader could not process this file.'),null,true);};
    current.onmessageerror=()=>finish(Error('The local PDF reader returned invalid data.'),null,true);
    current.postMessage(copy,[copy.buffer]);
  }));
  queue=result.catch(()=>{});return result;
}
