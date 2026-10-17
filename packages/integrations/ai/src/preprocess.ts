/**
 * File preprocessing for extraction (8.1): HEIC → JPEG, PDF → page images (max 10), photos
 * auto-rotated and size-capped. Also image dimensions (section 9's logo filter) and a 64-bit
 * difference hash for the duplicate check (7.6 DUPLICATE_EVIDENCE).
 */
import { createRequire } from "node:module";
import path from "node:path";
import sharp from "sharp";

export const MAX_PDF_PAGES = 10;
const MAX_EDGE = 2000;

export const EXTRACTABLE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif", "application/pdf"] as const;

export function isExtractable(mimeType: string): boolean {
  return (EXTRACTABLE_TYPES as readonly string[]).includes(mimeType);
}

export interface Pages {
  /** JPEG page images. */
  pages: Buffer[];
  /** Pages in the source (a PDF may have more than were rendered). */
  sourcePages: number;
}

async function heicToJpeg(buf: Buffer): Promise<Buffer> {
  const { default: convert } = await import("heic-convert");
  const out = await convert({ buffer: new Uint8Array(buf), format: "JPEG", quality: 0.92 });
  return Buffer.from(out as unknown as ArrayBuffer);
}

function normalizeImage(buf: Buffer): Promise<Buffer> {
  return sharp(buf, { failOn: "error" })
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function pdfToImages(buf: Buffer): Promise<Pages> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    standardFontDataUrl: `${root}/standard_fonts/`,
    cMapUrl: `${root}/cmaps/`,
    cMapPacked: true,
    disableFontFace: true,
  }).promise;
  try {
    const pages: Buffer[] = [];
    const n = Math.min(doc.numPages, MAX_PDF_PAGES);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(3, MAX_EDGE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const factory = (doc as unknown as { canvasFactory: { create(w: number, h: number): { canvas: { toBuffer(t: string): Buffer }; context: unknown } } })
        .canvasFactory;
      const cc = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: cc.context as never, canvas: cc.canvas as never, viewport }).promise;
      pages.push(await normalizeImage(cc.canvas.toBuffer("image/png")));
      page.cleanup();
    }
    return { pages, sourcePages: doc.numPages };
  } finally {
    await doc.cleanup();
    await doc.loadingTask.destroy();
  }
}

/** Throws for files that can't be decoded; the caller marks the extraction FAILED. */
export async function toPages(buf: Buffer, mimeType: string): Promise<Pages> {
  if (mimeType === "application/pdf") return pdfToImages(buf);
  if (mimeType === "image/heic" || mimeType === "image/heif") {
    return { pages: [await normalizeImage(await heicToJpeg(buf))], sourcePages: 1 };
  }
  if (mimeType.startsWith("image/")) return { pages: [await normalizeImage(buf)], sourcePages: 1 };
  throw new Error(`Can't read ${mimeType} files`);
}

/** Width and height, or null if the bytes aren't a decodable image (HEIC needs conversion first). */
export async function imageSize(buf: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const m = await sharp(buf).metadata();
    if (!m.width || !m.height) return null;
    // EXIF orientations 5–8 swap the axes.
    return m.orientation && m.orientation >= 5 ? { width: m.height, height: m.width } : { width: m.width, height: m.height };
  } catch {
    return null;
  }
}

/** 64-bit difference hash (dHash) as 16 hex characters. Similar images differ in few bits. */
export async function differenceHash(buf: Buffer): Promise<string> {
  const { data } = await sharp(buf).rotate().grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let hex = "";
  for (let row = 0; row < 8; row++) {
    let nibbleBits = 0;
    let count = 0;
    for (let col = 0; col < 8; col++) {
      const left = data[row * 9 + col]!;
      const right = data[row * 9 + col + 1]!;
      nibbleBits = (nibbleBits << 1) | (left > right ? 1 : 0);
      if (++count === 4) {
        hex += nibbleBits.toString(16);
        nibbleBits = 0;
        count = 0;
      }
    }
  }
  return hex;
}
