const sharp = require('sharp');

// Formats sharp can safely re-encode in place. Skip gif (animation) & svg (vector).
const COMPRESSIBLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/tiff']);

const MAX_DIMENSION = Number(process.env.IMAGE_MAX_DIMENSION) || 2000; // px, longest side
const JPEG_QUALITY  = Number(process.env.IMAGE_JPEG_QUALITY) || 80;
const WEBP_QUALITY  = Number(process.env.IMAGE_WEBP_QUALITY) || 80;
const PNG_QUALITY   = Number(process.env.IMAGE_PNG_QUALITY) || 80;

// Returns a compressed buffer, or the ORIGINAL buffer if compression isn't
// applicable or wouldn't help. Never throws — compression must never fail an upload.
async function compressImageBuffer(buffer, mimetype) {
    if (!buffer || !COMPRESSIBLE.has(mimetype)) return buffer;
    try {
        let pipeline = sharp(buffer)
            .rotate()                                   // bake in EXIF orientation before metadata is stripped
            .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true });

        if (mimetype === 'image/jpeg')      pipeline = pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
        else if (mimetype === 'image/png')  pipeline = pipeline.png({ quality: PNG_QUALITY, compressionLevel: 9 });
        else if (mimetype === 'image/webp') pipeline = pipeline.webp({ quality: WEBP_QUALITY });
        else if (mimetype === 'image/tiff') pipeline = pipeline.tiff({ quality: JPEG_QUALITY });

        const out = await pipeline.toBuffer();
        // Guard: never store something larger than the original (e.g. tiny/already-optimized images).
        return out.length < buffer.length ? out : buffer;
    } catch (err) {
        console.warn('[imageCompression] skipped — sharp failed:', err.message);
        return buffer;
    }
}

module.exports = { compressImageBuffer, COMPRESSIBLE };
