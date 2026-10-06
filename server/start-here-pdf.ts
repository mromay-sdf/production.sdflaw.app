import { PDFDocument } from 'pdf-lib'
import type { Production } from '../shared/model'
import { pdfBrand, reportHeader, productionSummary, reportFooter, wrap, ink, navy } from './pdf-brand'

export async function startHerePdf(p:Production):Promise<Buffer> {
  const pdf=await PDFDocument.create(),brand=await pdfBrand(pdf),page=pdf.addPage([612,792])
  reportHeader(page,brand,p,'OFFLINE PRODUCTION')
  let y=productionSummary(page,brand,p)-6
  const section=(title:string,text:string)=>{
    page.drawText(title,{x:44,y,size:12,font:brand.bold,color:navy});y-=19
    for(const line of wrap(text,brand.font,10,524)){page.drawText(line,{x:44,y,size:10,font:brand.font,color:ink});y-=14}
    y-=17
  }
  section('Start here', 'Extract the entire ZIP before opening any files. Keep the Production folder and its contents together. No internet connection or sign-in is required.')
  section('1. Open the document viewer', 'Inside the Production folder, open index.html in Microsoft Edge or Google Chrome. Select a document in the index to preview it. Search by document name or Bates number, or filter by tag. Drag the divider to resize the index and preview.')
  section('2. Open PDFs directly if needed', 'If your browser blocks embedded previews, select Open PDF in the viewer. You can also open the PDFs folder and view an individual document in your usual PDF reader.')
  section('3. Use the Excel index', 'Bates Index.xlsx lists the document names, Bates ranges, page counts, descriptions, dates, and tags captured at export time.')
  section('About this copy', 'This package is a snapshot. Later changes in SDF Production will not update these files. Bates labels and filenames reflect the exported production. This guide is not Bates numbered.')
  section('Handling the package', 'The exported files are not password protected and do not require authentication. Store and transfer this confidential production according to firm policy.')
  reportFooter(page,brand,'Offline package guide  |  Page 1 of 1')
  pdf.setTitle(`${p.name} - Start Here`);pdf.setCreator('SDF Production')
  return Buffer.from(await pdf.save())
}
