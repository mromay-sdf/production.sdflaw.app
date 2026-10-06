import { test, expect } from 'vitest'
import { PDFDocument, PDFArray, PDFDict, PDFName, degrees } from 'pdf-lib'
import { randomUUID } from 'node:crypto'
import { mkdir,writeFile } from 'node:fs/promises'
import { indexedPdf } from '../server/indexed-pdf'
import { startHerePdf } from '../server/start-here-pdf'
import { defaultBates, type Production } from '../shared/model'
test('indexed export links every entry and rotated page back to the correct index without overlaying the original crop',async()=>{
  const bytes=new Map<string,Buffer>()
  const p:Production={id:randomUUID(),name:'Synthetic indexed production – Bank records',matter:'Synthetic matter',description:'',createdBy:{id:'test',name:'Test'},createdAt:'',updatedAt:'',revision:1,status:'Ready for Review',documents:[],tags:[{id:'bank',name:'Bank records'}],exports:[],bates:defaultBates}
  for(let i=0;i<24;i++){
    const input=await PDFDocument.create();const page=input.addPage([612,792]);page.setCropBox(20,30,560,720);page.setRotation(degrees((i%4)*90));page.drawText(`Synthetic document ${i+1}`,{x:60,y:650});page.drawText(`SDF_${String(i+1).padStart(6,'0')}`,{x:400,y:55,size:9})
    const key=randomUUID();bytes.set(key,Buffer.from(await input.save()))
    p.documents.push({id:randomUUID(),originalName:`Record ${i+1}.pdf`,displayName:`Document ${i+1}: bank statements and financial records for review`,originalKey:key,processedKey:key,sha256:'',size:100,pageCount:1,firstBates:`SDF_${String(i+1).padStart(6,'0')}`,lastBates:`SDF_${String(i+1).padStart(6,'0')}`,description:'',documentDate:'',tagIds:['bank'],status:'Processed',source:{provider:'upload'}})
  }
  const result=await indexedPdf(p,{get:async key=>bytes.get(key)!,put:async()=>'',delete:async()=>{}},true)
  const pdf=await PDFDocument.load(result),indexCount=pdf.getPageCount()-p.documents.length
  expect(indexCount).toBeGreaterThan(1)
  const refs=pdf.getPages().map(page=>page.ref.toString()),indexRefs=refs.slice(0,indexCount)
  let entry=0
  for(let i=0;i<indexCount;i++){
    const annots=pdf.getPage(i).node.Annots()!
    for(let j=0;j<annots.size();j++){
      const a=annots.lookup(j,PDFDict),dest=a.lookup(PDFName.of('Dest'),PDFArray)
      expect(dest.get(0).toString()).toBe(refs[indexCount+entry++])
    }
  }
  expect(entry).toBe(24)
  for(let i=0;i<24;i++){
    const page=pdf.getPage(indexCount+i),rotation=(i%4)*90,crop=page.getCropBox()
    expect(page.getRotation().angle).toBe(rotation)
    expect(crop).toEqual(rotation===0?{x:20,y:6,width:560,height:744}:rotation===90?{x:20,y:30,width:584,height:720}:rotation===180?{x:20,y:30,width:560,height:744}:{x:-4,y:30,width:584,height:720})
    const a=page.node.Annots()!.lookup(0,PDFDict),dest=a.lookup(PDFName.of('Dest'),PDFArray)
    expect(indexRefs).toContain(dest.get(0).toString())
    const rect=a.lookup(PDFName.of('Rect'),PDFArray).asArray().map(n=>Number(n.toString()))
    // The new link rectangle is strictly outside the original crop's interior.
    expect(rotation===0?rect[3]<=30:rotation===90?rect[0]>=580:rotation===180?rect[1]>=750:rect[2]<=20).toBe(true)
  }
  expect(pdf.catalog.has(PDFName.of('Outlines'))).toBe(true)
  for(let i=0;i<indexCount;i++)expect(pdf.getPage(i).node.Resources()!.lookup(PDFName.of('XObject'),PDFDict).keys().length).toBeGreaterThan(0)
  await mkdir('test-results',{recursive:true});await writeFile('test-results/indexed-production.pdf',result)
  const guide=await startHerePdf(p),guidePdf=await PDFDocument.load(guide)
  expect(guidePdf.getPageCount()).toBe(1)
  expect(guidePdf.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'),PDFDict).keys().length).toBeGreaterThan(0)
  await writeFile('test-results/start-here.pdf',guide)
  await writeFile('test-results/start-here-long.pdf',await startHerePdf({...p,name:'W'.repeat(160),matter:'W'.repeat(160)}))
})
