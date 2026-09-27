// PDF packer — zero dependency, shared by every canvas-composed export
// (storyboard, references, …).
//
// Each page is composed on an offscreen canvas, exported as JPEG, then packed
// by hand into a multi-page PDF (DCTDecode image XObjects). One module owns the
// packer so a fix lands once for every exporter that uses it.

/** A4 landscape in PostScript points — the house page. */
export const PDF_PAGE_PT = { w: 842, h: 595 };

/** Load an image (local hjen-file:// or data URL) into an <img> element. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

/** Strip a data: URL down to its raw bytes. */
export function dataUrlToJpegBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(',')[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** One composed canvas → one PDF page payload. */
export function canvasToPage(canvas: HTMLCanvasElement, quality = 0.9): PdfPage {
  return { jpeg: dataUrlToJpegBytes(canvas.toDataURL('image/jpeg', quality)), w: canvas.width, h: canvas.height };
}

/** Uint8Array → base64, chunked so a large PDF doesn't blow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  }
  return btoa(binary);
}

export interface PdfPage { jpeg: Uint8Array; w: number; h: number }

/** Pack full-bleed JPEG pages into a single PDF file. */
export function assemblePdf(pages: PdfPage[]): Uint8Array {
  const PW = PDF_PAGE_PT.w, PH = PDF_PAGE_PT.h;
  const enc = (s: string) => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff; return a; };
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (u: Uint8Array) => { chunks.push(u); pos += u.length; };
  const pushStr = (s: string) => push(enc(s));
  pushStr('%PDF-1.3\n');
  const N = pages.length;
  const pageObjNums: number[] = [], imgNums: number[] = [], contentNums: number[] = [];
  let objNum = 3;
  for (let i = 0; i < N; i++) { imgNums.push(objNum++); contentNums.push(objNum++); pageObjNums.push(objNum++); }
  const totalObjs = objNum - 1;
  const startObj = (n: number) => { offsets[n] = pos; pushStr(`${n} 0 obj\n`); };
  const endObj = () => pushStr('endobj\n');
  startObj(1); pushStr('<< /Type /Catalog /Pages 2 0 R >>\n'); endObj();
  startObj(2); pushStr(`<< /Type /Pages /Count ${N} /Kids [ ${pageObjNums.map(n => `${n} 0 R`).join(' ')} ] >>\n`); endObj();
  for (let i = 0; i < N; i++) {
    const p = pages[i];
    startObj(imgNums[i]);
    pushStr(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    push(p.jpeg); pushStr('\nendstream\n'); endObj();
    const content = `q\n${PW} 0 0 ${PH} 0 0 cm\n/Im0 Do\nQ\n`;
    startObj(contentNums[i]);
    pushStr(`<< /Length ${content.length} >>\nstream\n${content}endstream\n`); endObj();
    startObj(pageObjNums[i]);
    pushStr(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${imgNums[i]} 0 R >> >> /Contents ${contentNums[i]} 0 R >>\n`);
    endObj();
  }
  const xrefPos = pos;
  pushStr(`xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`);
  for (let n = 1; n <= totalObjs; n++) pushStr(`${(offsets[n] ?? 0).toString().padStart(10, '0')} 00000 n \n`);
  pushStr(`trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  const out = new Uint8Array(pos);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
