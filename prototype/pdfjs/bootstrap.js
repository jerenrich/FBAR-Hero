// A classic script can explain file:// startup failure before any module loads.
// The HTML also contains a static recovery link and disabled entry controls.
(async function startEditor(){
  const status=document.querySelector('#status'),help=document.querySelector('#startup-help');
  if(location.protocol==='file:'){
    const link=document.createElement('a');link.href='http://127.0.0.1:3141/';link.textContent='Open the working local app';
    help.replaceChildren('Start the local server, then ',link,'. Your files stay on this computer.');
    status.textContent='This is the HTML file, not the running editor. Use the local app link above to import your PDF.';
    return;
  }
  help.textContent='The editor must finish loading before you can choose a PDF. If loading fails, check your connection and refresh this page. Your files stay on this computer.';
  const slow=setTimeout(()=>{
    status.textContent='The editor has not finished loading. Check your connection and refresh this page.';
    help.hidden=false;
  },20000);
  try{
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='/vendor/pdf-lib.js';
      script.onload=resolve;script.onerror=()=>reject(new Error('PDF library failed to load'));
      document.head.append(script);
    });
    if(!window.PDFLib)throw new Error('PDF library unavailable');
    await import('/pdfjs/app.mjs');
    if(!window.experiment)throw new Error('Editor failed to initialize');
    for(const id of ['new','import-file','count','load'])document.getElementById(id).disabled=false;
    status.textContent='Start a blank draft or import a completed FBAR.';
    help.hidden=true;
  }catch{
    status.textContent='The editor could not start. Check your connection and refresh this page. No PDF has been opened.';
    help.hidden=false;
  }finally{
    clearTimeout(slow);
  }
})();
