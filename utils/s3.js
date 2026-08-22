const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { compressImageBuffer } = require('./imageCompression');
require('dotenv').config();

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const MAX_BASENAME_LEN = 128;
const VALID_KEY_RE = /^[A-Za-z0-9._\-/]+$/;

function sanitizeS3Key(name) {
  const basename = path.basename(String(name || ''));
  const cleaned = basename
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.-]+/, '')
    .slice(0, MAX_BASENAME_LEN);
  return cleaned || 'file';
}

function assertValidS3Key(key) {
  const k = String(key || '');
  if (!k || k.length > 512 || !VALID_KEY_RE.test(k) || k.split('/').includes('..')) {
    const err = new Error('Invalid S3 key');
    err.code = 'INVALID_S3_KEY';
    throw err;
  }
}

async function uploadToS3(file) {
  const key = `${Date.now()}-${uuidv4()}-${sanitizeS3Key(file.originalname)}`;

  // Compress images in place (same format); non-images / no-gain return the original buffer.
  const body = await compressImageBuffer(file.buffer, file.mimetype);

  const command = new PutObjectCommand({
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: file.mimetype
  });

  await s3.send(command);

  return key;
}

async function generatePresignedUrl(key, disposition = 'inline') {
  assertValidS3Key(key);

  const command = new GetObjectCommand({
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: key,
    ResponseContentDisposition: disposition === 'download' ? 'attachment' : 'inline'
  });

  const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
  return url;
}
module.exports = { uploadToS3, generatePresignedUrl, sanitizeS3Key, assertValidS3Key };
