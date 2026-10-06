import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString()
export default function PdfPreview({blob,title,toolbar}:{blob:Blob;title:string;toolbar:HTMLElement|null}) {
  const [pdf,setPdf]=useState<PDFDocumentProxy>(),[page,setPage]=useState(1),[zoom,setZoom]=useState(1),[width,setWidth]=useState(600),[error,setError]=useState(''),[rendering,setRendering]=useState(true)
  const container=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null)
  const [height,setHeight]=useState(600),[fit,setFit]=useState('page')
  useEffect(()=>{let canceled=false;let task:ReturnType<typeof getDocument>|undefined;setPage(1);setPdf(undefined);setError('');setRendering(true)
    void blob.arrayBuffer().then(buffer=>{if(canceled)return;task=getDocument({data:new Uint8Array(buffer),standardFontDataUrl:'/pdfjs/standard_fonts/',cMapUrl:'/pdfjs/cmaps/',cMapPacked:true,wasmUrl:'/pdfjs/wasm/',isEvalSupported:false});return task.promise}).then(doc=>{if(doc&&!canceled)setPdf(doc)}).catch(e=>{if(!canceled){setError('This PDF cannot be previewed here. Use Open PDF directly.');setRendering(false)}})
    return()=>{canceled=true;void task?.destroy()}
  },[blob])
  useEffect(()=>{if(!container.current)return;const observer=new ResizeObserver(([entry])=>{setWidth(Math.max(100,entry.contentRect.width));setHeight(Math.max(100,entry.contentRect.height))});observer.observe(container.current);return()=>observer.disconnect()},[])
  useEffect(()=>{if(!pdf||!canvas.current)return;let canceled=false;let task:ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>|undefined;setRendering(true)
    void pdf.getPage(page).then(p=>{if(canceled||!canvas.current)return;const natural=p.getViewport({scale:1});const base=fit==='page'?Math.min(width/natural.width,height/natural.height):width/natural.width;const scale=base*zoom;const viewport=p.getViewport({scale});const ratio=Math.min(devicePixelRatio||1,2);const c=canvas.current;c.width=Math.floor(viewport.width*ratio);c.height=Math.floor(viewport.height*ratio);c.style.width=`${viewport.width}px`;c.style.height=`${viewport.height}px`;task=p.render({canvas:c,viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]});return task.promise}).then(()=>{if(!canceled)setRendering(false)}).catch(e=>{if(!canceled&&e.name!=='RenderingCancelledException'){setError('Preview rendering failed. Open the PDF directly.');setRendering(false)}})
    return()=>{canceled=true;task?.cancel()}
  },[pdf,page,width,height,fit,zoom])
  const controls=<div className="page-controls"><button aria-label="Previous PDF page" disabled={!pdf||page<=1} onClick={()=>setPage(page-1)}><ChevronLeft/></button><span>Page {page} / {pdf?.numPages??'…'}</span><button aria-label="Next PDF page" disabled={!pdf||page>=pdf.numPages} onClick={()=>setPage(page+1)}><ChevronRight/></button><select aria-label="PDF fit" value={fit} onChange={e=>{setFit(e.target.value);setZoom(1)}}><option value="page">Fit page</option><option value="width">Fit width</option></select><button aria-label="Zoom out" disabled={zoom<=.5} onClick={()=>setZoom(Math.max(.5,zoom-.25))}><ZoomOut/></button><span>{Math.round(zoom*100)}%</span><button aria-label="Zoom in" disabled={zoom>=2} onClick={()=>setZoom(Math.min(2,zoom+.25))}><ZoomIn/></button></div>
  return <div className="pdf-renderer">{toolbar?createPortal(controls,toolbar):controls}<div className="canvas-scroll" ref={container}>{rendering&&!error&&<span className="render-status" role="status">Rendering page…</span>}{error?<p className="feedback error">{error}</p>:<canvas ref={canvas} role="img" aria-label={`${title}, page ${page}`} data-rendered={!rendering}/>}</div></div>
}
