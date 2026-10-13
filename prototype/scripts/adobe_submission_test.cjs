// Native Reader serialization controls. Public blank and synthetic PDFs only;
// never signs, submits, or opens a personal document.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),PDFLib=require('pdf-lib');
const app='/Applications/Adobe Acrobat DC/Adobe Acrobat.app';
const out=path.resolve(__dirname,'../results/submission-metadata');
const fixture=path.resolve(__dirname,'../fixtures/official-blank.pdf');
const source=path.join(out,'SYNTHETIC-READER-ORIGIN.pdf');
const originSaved=path.join(out,'SYNTHETIC-READER-ORIGIN-SAVED.pdf');
const draft=path.join(out,'SYNTHETIC-fixed-draft.pdf');
const saved=path.join(out,'SYNTHETIC-READER-FIXED-SAVED.pdf');
function js(name,body){
 const script='(function(){var d=app.activeDocs.filter(function(x){return x.documentFileName==='+JSON.stringify(name)+';})[0];if(!d)return "WAIT";'+body+'})();';
 const apple='with timeout of 20 seconds\ntell application '+JSON.stringify(app)+' to do script '+JSON.stringify(script)+'\nend timeout';
 return execFileSync('/usr/bin/osascript',['-e',apple],{encoding:'utf8',timeout:25000}).trim();
}
async function open(file){
 execFileSync('/usr/bin/open',['-a',app,file]);
 for(let i=0;i<60;i++){
  if(js(path.basename(file),'return "READY";')==='READY')return;
  await new Promise(r=>setTimeout(r,250));
 }
 throw Error('Synthetic document did not open');
}
const snapshot=`var f=d.xfa.form,c=f.resolveNode('BSAForm.Common');
 c.ERRORS=[];c.WARNINGS=[];c.VALIDATING=true;c.SIGNING=true;
 try{return JSON.stringify({viewer:app.viewerType,version:app.viewerVersion,
  presignValid:f.execValidate(),errors:c.ERRORS,warnings:c.WARNINGS,
  countPresent:!!d.xfa.datasets.data.resolveNode('BSAForm.EFileSubmissionInformation.NumForms'),
  signed:f.resolveNode('BSAForm.Header.ActionFields.Signed').rawValue});}
 finally{c.VALIDATING=false;c.SIGNING=false;c.ERRORS=[];c.WARNINGS=[];}`;
(async()=>{
 const {inspectXfa,xfaFormChecksum}=await import('../xfa-packet-writer.mjs');
 fs.mkdirSync(out,{recursive:true});fs.copyFileSync(fixture,source);
 await open(source);
 js(path.basename(source),'d.xfa.form.resolveNode("BSAForm.Header.FilingName").rawValue="SYNTHETIC TEST ONLY DO NOT FILE";d.saveAs('+JSON.stringify(originSaved)+');return "saved";');
 const nativeCount=js(path.basename(originSaved),'return !!d.xfa.datasets.data.resolveNode("BSAForm.EFileSubmissionInformation.NumForms");');
 assert.equal(nativeCount,'false');js(path.basename(originSaved),'d.closeDoc(true);return "closed";');
 await open(draft);const before=JSON.parse(js(path.basename(draft),snapshot));
 assert(before.presignValid&&!before.errors.length&&!before.countPresent&&!before.signed);
 js(path.basename(draft),'d.saveAs('+JSON.stringify(saved)+');return "saved";');
 js(path.basename(saved),'d.closeDoc(true);return "closed";');await open(saved);
 const after=JSON.parse(js(path.basename(saved),snapshot));
 assert(after.presignValid&&!after.errors.length&&!after.countPresent&&!after.signed);
 js(path.basename(saved),'d.closeDoc(true);return "closed";');
 const a=(await inspectXfa(PDFLib,fs.readFileSync(draft),{strict:true})).packets;
 const b=(await inspectXfa(PDFLib,fs.readFileSync(saved),{strict:true})).packets;
 assert.deepEqual(b.template.bytes,a.template.bytes);
 const text=p=>new TextDecoder().decode(p.bytes);
 assert.equal(await xfaFormChecksum(text(b.template),text(b.datasets)),text(b.form).match(/checksum="([^"]+)"/)[1]);
 // Compare all populated values independently of Reader and the browser model.
 const compare=String.raw`import sys,json,xml.etree.ElementTree as E,collections
def leaves(s):
 root=E.fromstring(s).find('{http://www.xfa.org/schema/xfa-data/1.0/}data')[0];out={}
 def walk(n,path):
  if not len(n) and n.text:out[path]=n.text
  counts=collections.Counter()
  for c in n:
   index=counts[c.tag];counts[c.tag]+=1;walk(c,path+((c.tag,index),))
 walk(root,((root.tag,0),));return out
a,b=map(leaves,json.load(sys.stdin));print(json.dumps({'populatedValues':len(a),'matches':a==b}))`;
 const compared=JSON.parse(execFileSync('python3',['-c',compare],{input:JSON.stringify([text(a.datasets),text(b.datasets)]),encoding:'utf8'}));
 assert(compared.matches);
 const report={nativeOriginEmptyCountOmitted:true,before,after,compared,templatePreserved:true,formChecksumMatches:true,signed:false,submitted:false};
 fs.writeFileSync(path.join(out,'adobe-results.json'),JSON.stringify(report,null,2)+'\n');
 console.log('PASS: native Reader excludes the empty optional count; corrected synthetic draft validates and saves/reopens unsigned with all populated values and template preserved and a matching form checksum. No submission.');
})().catch(e=>{console.error(e);process.exit(1)});
