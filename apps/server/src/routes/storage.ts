import { Elysia, t } from "elysia";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";

// Initialize S3 client for Cloudflare R2
const getS3Client = () => {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials not configured");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
};

const BUCKET = process.env.R2_BUCKET_NAME || "screenshare-recordings";

// Presigned URL expiry times
const UPLOAD_URL_EXPIRY = 3600; // 1 hour
const DOWNLOAD_URL_EXPIRY = 86400; // 24 hours

export const storageRoutes = new Elysia({ prefix: "/storage" })
  /**
   * Get a presigned URL for uploading a recording chunk
   */
  .post(
    "/upload-url",
    async ({ body }) => {
      const s3 = getS3Client();
      const { sessionId, chunkIndex, contentType } = body;

      // Generate unique storage key
      const key = `recordings/${sessionId}/${chunkIndex}-${nanoid(8)}.webm`;

      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: contentType || "video/webm",
      });

      const uploadUrl = await getSignedUrl(s3, command, {
        expiresIn: UPLOAD_URL_EXPIRY,
      });

      return {
        uploadUrl,
        storageKey: key,
        expiresIn: UPLOAD_URL_EXPIRY,
      };
    },
    {
      body: t.Object({
        sessionId: t.String(),
        chunkIndex: t.Number(),
        contentType: t.Optional(t.String()),
      }),
    }
  )

  /**
   * Get a presigned URL for uploading a frame sample
   */
  .post(
    "/frame-upload-url",
    async ({ body }) => {
      const s3 = getS3Client();
      const { sessionId, timestamp } = body;

      // Generate unique storage key
      const key = `frames/${sessionId}/${timestamp}-${nanoid(8)}.jpg`;

      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: "image/jpeg",
      });

      const uploadUrl = await getSignedUrl(s3, command, {
        expiresIn: UPLOAD_URL_EXPIRY,
      });

      return {
        uploadUrl,
        storageKey: key,
        expiresIn: UPLOAD_URL_EXPIRY,
      };
    },
    {
      body: t.Object({
        sessionId: t.String(),
        timestamp: t.Number(),
      }),
    }
  )

  /**
   * Get a presigned URL for downloading a recording or frame
   */
  .get(
    "/download-url/:key",
    async ({ params }) => {
      const s3 = getS3Client();
      const key = decodeURIComponent(params.key);

      const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
      });

      const downloadUrl = await getSignedUrl(s3, command, {
        expiresIn: DOWNLOAD_URL_EXPIRY,
      });

      return {
        downloadUrl,
        expiresIn: DOWNLOAD_URL_EXPIRY,
      };
    },
    {
      params: t.Object({
        key: t.String(),
      }),
    }
  );
