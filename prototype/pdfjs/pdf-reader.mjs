// Parse untrusted PDFs away from the editor. A stalled parser can be terminated
// without losing the user's in-memory draft. Requests share a warmed worker so
// normal imports and comparisons continue to work after going offline.
let worker=null,ready=false,queue=Promise.resolve();
const timeoutMs=15_000,startupTimeoutMs=30_000;
export function readPackets(bytes){
  if(bytes.byteLength>25_000_000)return Promise.reject(Error('Choose an FBAR PDF smaller than 25 MB.'));
  const copy=new Uint8Array(bytes);
  const result=queue.then(()=>new Promise((resolve,reject)=>{
    const current=worker||(worker=new Worker('/pdfjs/pdf-reader-worker.js'));
    let timer,started=false;
    const finish=(error,packets,discard=false)=>{
      clearTimeout(timer);current.onmessage=null;current.onerror=null;current.onmessageerror=null;
      if(discard){current.terminate();worker=null;ready=false;}
      if(error)reject(error);else resolve(packets);
    };
    // Network startup must not consume the untrusted parser's time budget.
    // Transfer the PDF only after the trusted worker dependencies are ready.
    const start=()=>{
      if(started)return;started=true;clearTimeout(timer);
      timer=setTimeout(()=>finish(Error('PDF processing exceeded the time limit. Your current draft is unchanged.'),null,true),timeoutMs);
      current.postMessage(copy,[copy.buffer]);
    };
    current.onmessage=({data})=>{
      if(data.ready===true){ready=true;start();return;}
      if(data.error)finish(Error(data.error),null,data.recycle===true);
      else finish(null,data.packets);
    };
    current.onerror=event=>{event.preventDefault();finish(Error(started?'The local PDF reader could not process this file.':'The local PDF reader could not start. Check your connection and retry.'),null,true);};
    current.onmessageerror=()=>finish(Error('The local PDF reader returned invalid data.'),null,true);
    if(ready)start();
    else {
      timer=setTimeout(()=>finish(Error('The local PDF reader did not finish loading. Check your connection and retry. Your current draft is unchanged.'),null,true),startupTimeoutMs);
      current.postMessage({initialize:true});
    }
  }));
  queue=result.catch(()=>{});return result;
}
