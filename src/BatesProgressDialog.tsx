import { useEffect, useRef } from 'react'
import type { BatesProgress, Production } from '../shared/model'
import { batesRange } from '../shared/model'
export interface BatesRun {progress:BatesProgress;result?:Production;error?:string}
export default function BatesProgressDialog({run,onClose,onContinue}:{run:BatesRun;onClose:()=>void;onContinue:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),finished=Boolean(run.result||run.error)
  useEffect(()=>{dialog.current?.showModal()},[])
  const progress=run.progress
  return <dialog ref={dialog} aria-labelledby="bates-progress-title" className="bates-progress-dialog" onCancel={e=>{if(!finished)e.preventDefault();else onClose()}}>
    <h2 id="bates-progress-title">{run.result?'Bates labeling complete':run.error?'Bates labeling interrupted':progress.phase}</h2>
    {!finished&&<><p className="muted">Numbering pages and preparing your production. Keep this window open.</p><p className="progress-file">{progress.fileName||'Preparing output…'}</p></>}
    <progress aria-label="Bates pages processed" max={Math.max(1,progress.totalPages)} value={progress.currentPage}/>
    <div className="progress-counts"><span>{progress.currentPage.toLocaleString()} / {progress.totalPages.toLocaleString()} pages labeled</span><span>{progress.completedDocuments} / {progress.totalDocuments} documents saved</span></div>
    {progress.batesValue&&!run.error&&<p className="numeric">{run.result?batesRange(run.result):progress.batesValue}</p>}
    {run.result&&<p className="success">0 processing errors. The production has been saved.</p>}
    {run.error&&<p className="danger" role="alert">{run.error}</p>}
    <div className="dialog-actions">{finished&&<button onClick={onClose}>Close</button>}{run.result&&<button className="primary" onClick={onContinue}>Continue to Index & Tags</button>}</div>
  </dialog>
}
