import { pdfBrand, reportHeader, productionSummary, reportFooter, wrap as lines, ink as navy, muted } from './pdf-brand'
import { PDFDocument, PDFPage, PDFFont, PDFName, PDFHexString, PDFNumber, rgb, degrees } from 'pdf-lib'

import type { Production } from '../shared/model'
import type { DocumentStorage } from './storage'
import { normalizeRotation, visualPointToPagePoint } from '../shared/sdf-pdf/pdf/coordinates'

function link(pdf:PDFDocument,page:PDFPage,rect:number[],target:PDFPage) {
  page.node.addAnnot(pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:rect,Border:[0,0,0],Dest:[target.ref,'Fit'],F:4})))
}
function returnLink(pdf:PDFDocument,page:PDFPage,target:PDFPage,font:PDFFont) {
  const old=page.getCropBox(),rotation=normalizeRotation(page.getRotation().angle),band=24
  // Extend the *visual bottom*, respecting non-zero origins and page rotation.
  // Existing page content/annotations remain in their original coordinates.
  const box={...old}
  if(rotation===0){box.y-=band;box.height+=band}
  if(rotation===90)box.width+=band
  if(rotation===180)box.height+=band
  if(rotation===270){box.x-=band;box.width+=band}
  const media=page.getMediaBox(),left=Math.min(media.x,box.x),bottom=Math.min(media.y,box.y)
  page.setMediaBox(left,bottom,Math.max(media.x+media.width,box.x+box.width)-left,Math.max(media.y+media.height,box.y+box.height)-bottom)
  page.setCropBox(box.x,box.y,box.width,box.height)
  const strip=rotation===0?{x:box.x,y:box.y,width:box.width,height:band}:rotation===90?{x:old.x+old.width,y:box.y,width:band,height:box.height}:rotation===180?{x:box.x,y:old.y+old.height,width:box.width,height:band}:{x:box.x,y:box.y,width:band,height:box.height}
  page.drawRectangle({...strip,color:rgb(1,1,1)})
  const point=visualPointToPagePoint(12,8,box,rotation)
  const text='Return to index',size=9,textWidth=font.widthOfTextAtSize(text,size)
  page.drawText(text,{...point,size,font,color:navy,rotate:degrees(rotation)})
  const points=[[10,4],[16+textWidth,4],[10,20],[16+textWidth,20]].map(([x,y])=>visualPointToPagePoint(x,y,box,rotation))
  link(pdf,page,[Math.min(...points.map(p=>p.x)),Math.min(...points.map(p=>p.y)),Math.max(...points.map(p=>p.x)),Math.max(...points.map(p=>p.y))],target)
}
export async function indexedPdf(p:Production,storage:DocumentStorage,includeTags=true):Promise<Buffer> {
  if(!p.documents.length||p.documents.some(d=>!d.processedKey))throw new Error('Processed PDFs are required.')
  const pdf=await PDFDocument.create();const brand=await pdfBrand(pdf)
  const {font}=brand
  const entries:{doc:Production['documents'][number];page:PDFPage;y:number;height:number;nameLines:string[];tagLines:string[]}[]=[]
  const indexPages:PDFPage[]=[]
  let page:PDFPage,y=0
  const addIndex=()=>{
    page=pdf.addPage([612,792]);indexPages.push(page)
    reportHeader(page,brand,p,'DOCUMENT INDEX')
    y=productionSummary(page,brand,p)
    page.drawText('Select a document to open it. Document pages include a return link.',{x:44,y,size:10,font,color:muted});y-=23
    page.drawText('Document / Bates range',{x:44,y,size:10,font:brand.bold,color:navy})
    page.drawText('PDF page',{x:523,y,size:10,font:brand.bold,color:navy});y-=17
  }
  addIndex()
  for(const doc of p.documents){
    const nameLines=lines(doc.displayName,font,11,450)
    const allTagLines=includeTags?lines(p.tags.filter(t=>doc.tagIds.includes(t.id)).map(t=>t.name).join(' · '),font,9,450):[]
    const tagLines=allTagLines.length>3?[...allTagLines.slice(0,2),'Additional tags omitted from this index entry.']:allTagLines
    const height=Math.max(48,nameLines.length*14+tagLines.length*12+26)
    if(y-height<56)addIndex()
    entries.push({doc,page:page!,y,height,nameLines,tagLines});y-=height
  }
  const bookmarks:{title:string;page:PDFPage}[]=[{title:'Document index',page:indexPages[0]}]
  for(const entry of entries){
    const source=await PDFDocument.load(await storage.get(entry.doc.processedKey!),{ignoreEncryption:false,updateMetadata:false})
    const start=pdf.getPageCount()+1
    const copied=await pdf.copyPages(source,source.getPageIndices())
    for(const documentPage of copied){pdf.addPage(documentPage);returnLink(pdf,documentPage,entry.page,font)}
    bookmarks.push({title:entry.doc.displayName,page:copied[0]})
    let rowY=entry.y-15
    entry.nameLines.forEach(text=>{entry.page.drawText(text,{x:44,y:rowY,size:11,font,color:navy});rowY-=14})
    entry.page.drawText(`${entry.doc.firstBates} – ${entry.doc.lastBates}`,{x:44,y:rowY,size:9,font,color:muted});rowY-=13
    entry.tagLines.forEach(text=>{entry.page.drawText(text,{x:44,y:rowY,size:9,font,color:muted});rowY-=12})
    entry.page.drawText(String(start),{x:546,y:entry.y-15,size:11,font,color:navy})
    entry.page.drawLine({start:{x:44,y:entry.y-entry.height+3},end:{x:568,y:entry.y-entry.height+3},thickness:.5,color:rgb(.85,.85,.85)})
    link(pdf,entry.page,[40,entry.y-entry.height+4,572,entry.y],copied[0])
  }
  indexPages.forEach((page,i)=>reportFooter(page,brand,`Index ${i+1} of ${indexPages.length}  |  Index pages are not Bates numbered`))
  const outline=pdf.context.obj({Type:'Outlines'}),outlineRef=pdf.context.register(outline)
  const items=bookmarks.map(b=>{const item=pdf.context.obj({Title:PDFHexString.fromText(b.title),Parent:outlineRef,Dest:[b.page.ref,'Fit']});return {item,ref:pdf.context.register(item)}})
  items.forEach(({item},i)=>{if(i)item.set(PDFName.of('Prev'),items[i-1].ref);if(i<items.length-1)item.set(PDFName.of('Next'),items[i+1].ref)})
  outline.set(PDFName.of('First'),items[0].ref);outline.set(PDFName.of('Last'),items.at(-1)!.ref);outline.set(PDFName.of('Count'),PDFNumber.of(items.length))
  pdf.catalog.set(PDFName.of('Outlines'),outlineRef);pdf.catalog.set(PDFName.of('PageMode'),PDFName.of('UseOutlines'))
  pdf.setTitle(p.name);pdf.setCreator('SDF Production');pdf.setProducer('SDF Production indexed PDF')
  return Buffer.from(await pdf.save())
}
