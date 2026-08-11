// lib/convertImage.js
import sharp from 'sharp';

const MIME = { webp: 'image/webp', avif: 'image/avif', png: 'image/png', jpeg: 'image/jpeg' };

/**
 * Converts an image buffer to the requested format.
 * Returns { buffer, contentType }.
 */
export async function convertImage(inputBuffer, format = 'webp', quality = 80) {
  if (!MIME[format]) {
    throw Object.assign(new Error(`Unsupported image format: ${format}. Use webp, avif, png, or jpeg.`), { status: 400 });
  }
  let pipeline = sharp(inputBuffer);
  if (format === 'webp') pipeline = pipeline.webp({ quality });
  else if (format === 'avif') pipeline = pipeline.avif({ quality });
  else if (format === 'png') pipeline = pipeline.png({ quality });
  else if (format === 'jpeg') pipeline = pipeline.jpeg({ quality });

  const buffer = await pipeline.toBuffer();
  return { buffer, contentType: MIME[format] };
}