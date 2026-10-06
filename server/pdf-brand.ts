import { readFile } from 'node:fs/promises'
import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { batesRange, pages, type Production } from '../shared/model'

export const navy=rgb(13/255,44/255,79/255), ink=rgb(17/255,30/255,46/255), muted=rgb(.36,.41,.45)
export function wrap(text:string,font:PDFFont,size:number,width:number) {
  const output:string[]=[];let line=''
  for(const word of text.replace(/\s+/g,' ').trim().split(' ')) {
    if(line&&font.widthOfTextAtSize(line+' '+word,size)>width){output.push(line);line=''}
    for(const char of (line?' ':'')+word){if(font.widthOfTextAtSize(line+char,size)>width&&line){output.push(line);line=''}line+=char}
  }
  if(line)output.push(line);return output
}
export async function pdfBrand(pdf:PDFDocument) {
  pdf.registerFontkit(fontkit)
  const font=await pdf.embedFont(await readFile('public/pdfjs/standard_fonts/LiberationSans-Regular.ttf'),{subset:true})
  const bold=await pdf.embedFont(await readFile('public/pdfjs/standard_fonts/LiberationSans-Bold.ttf'),{subset:true})
  const logo=await pdf.embedPng(await readFile('public/sdf-ui/sdf-logo-report-white.png'))
  return {font,bold,logo}
}
type Brand=Awaited<ReturnType<typeof pdfBrand>>
export function reportHeader(page:PDFPage,brand:Brand,p:Production,title:string) {
  page.drawRectangle({x:36,y:674,width:540,height:82,color:navy})
  const scale=Math.min(128/brand.logo.width,54/brand.logo.height)
  page.drawImage(brand.logo,{x:50,y:674+(82-brand.logo.height*scale)/2,width:brand.logo.width*scale,height:brand.logo.height*scale})
  function right(text:string,size:number,y:number,font:PDFFont) {
    let fitted=text.replace(/\s+/g,' ').trim()
    if(font.widthOfTextAtSize(fitted,size)>362){while(fitted&&font.widthOfTextAtSize(fitted+'…',size)>362)fitted=fitted.slice(0,-1);fitted+='…'}
    page.drawText(fitted,{x:562-font.widthOfTextAtSize(fitted,size),y,size,font,color:rgb(1,1,1)})
  }
  right(title,15,731,brand.bold);right(p.name,10,709,brand.font);right(p.matter,9,690,brand.font)
}
export function productionSummary(page:PDFPage,brand:Brand,p:Production) {
  let y=652
  for(const text of wrap(p.name,brand.bold,11,524)){page.drawText(text,{x:44,y,size:11,font:brand.bold,color:ink});y-=14}
  for(const text of wrap(p.matter,brand.font,10,524)){page.drawText(text,{x:44,y,size:10,font:brand.font,color:muted});y-=13}
  page.drawText(`${p.documents.length} documents  |  ${pages(p)} pages`,{x:44,y:y-4,size:10,font:brand.font,color:ink});y-=20
  for(const text of wrap(`Bates: ${batesRange(p)}`,brand.font,9,524)){page.drawText(text,{x:44,y,size:9,font:brand.font,color:muted});y-=12}
  return y-10
}
export function reportFooter(page:PDFPage,brand:Brand,text:string) {
  page.drawLine({start:{x:36,y:43},end:{x:576,y:43},thickness:.5,color:rgb(.78,.78,.76)})
  page.drawText('SDF Production',{x:36,y:28,size:8,font:brand.font,color:muted})
  page.drawText(text,{x:576-brand.font.widthOfTextAtSize(text,8),y:28,size:8,font:brand.font,color:muted})
}
