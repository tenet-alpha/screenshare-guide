import { Elysia, t } from "elysia";
import {
  BlobServiceClient,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  StorageSharedKeyCredential,
  SASProtocol,
} from "@azure/storage-blob";
import { nanoid } from "nanoid";

// SAS token expiry times (in minutes)
const UPLOAD_SAS_EXPIRY_MINUTES = 60; // 1 hour
const DOWNLOAD_SAS_EXPIRY_MINUTES = 1440; // 24 hours

// Lazy-loaded clients
let _blobServiceClient: BlobServiceClient | null = null;
let _sharedKeyCredential: StorageSharedKeyCredential | null = null;

/**
 * Get Azure Blob Storage client (lazy initialization)
 */
function getBlobServiceClient(): BlobServiceClient {
  if (_blobServiceClient) return _blobServiceClient;

  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error("AZURE_STORAGE_CONNECTION_STRING environment variable is required");
  }

  _blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  return _blobServiceClient;
}

/**
 * Get container name from environment
 */
function getContainerName(): string {
  return process.env.AZURE_STORAGE_CONTAINER_NAME || "screenshare-recordings";
}

/**
 * Parse connection string to extract account name and key for SAS generation
 */
function getSharedKeyCredential(): StorageSharedKeyCredential {
  if (_sharedKeyCredential) return _sharedKeyCredential;

  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error("AZURE_STORAGE_CONNECTION_STRING environment variable is required");
  }

  // Parse connection string
  const accountNameMatch = connectionString.match(/AccountName=([^;]+)/);
  const accountKeyMatch = connectionString.match(/AccountKey=([^;]+)/);

  if (!accountNameMatch || !accountKeyMatch) {
    throw new Error("Invalid Azure Storage connection string format");
  }

  _sharedKeyCredential = new StorageSharedKeyCredential(
    accountNameMatch[1],
    accountKeyMatch[1]
  );

  return _sharedKeyCredential;
}

/**
 * Generate SAS URL for blob upload
 */
async function generateUploadSasUrl(blobName: string, contentType: string): Promise<string> {
  const blobServiceClient = getBlobServiceClient();
  const containerClient = blobServiceClient.getContainerClient(getContainerName());
  const blobClient = containerClient.getBlockBlobClient(blobName);
  const credential = getSharedKeyCredential();

  // Set expiry time
  const startsOn = new Date();
  const expiresOn = new Date(startsOn);
  expiresOn.setMinutes(expiresOn.getMinutes() + UPLOAD_SAS_EXPIRY_MINUTES);

  // Generate SAS token with write permissions
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName: getContainerName(),
      blobName,
      permissions: BlobSASPermissions.parse("cw"), // create + write
      startsOn,
      expiresOn,
      contentType,
      protocol: SASProtocol.Https,
    },
    credential
  ).toString();

  return `${blobClient.url}?${sasToken}`;
}

/**
 * Generate SAS URL for blob download
 */
async function generateDownloadSasUrl(blobName: string): Promise<string> {
  const blobServiceClient = getBlobServiceClient();
  const containerClient = blobServiceClient.getContainerClient(getContainerName());
  const blobClient = containerClient.getBlockBlobClient(blobName);
  const credential = getSharedKeyCredential();

  // Set expiry time
  const startsOn = new Date();
  const expiresOn = new Date(startsOn);
  expiresOn.setMinutes(expiresOn.getMinutes() + DOWNLOAD_SAS_EXPIRY_MINUTES);

  // Generate SAS token with read permissions
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName: getContainerName(),
      blobName,
      permissions: BlobSASPermissions.parse("r"), // read only
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
    },
    credential
  ).toString();

  return `${blobClient.url}?${sasToken}`;
}

export const storageRoutes = new Elysia({ prefix: "/storage" })
  /**
   * Get a SAS URL for uploading a recording chunk
   */
  .post(
    "/upload-url",
    async ({ body }) => {
      const { sessionId, chunkIndex, contentType } = body;

      // Generate unique storage key (blob name)
      const blobName = `recordings/${sessionId}/${chunkIndex}-${nanoid(8)}.webm`;

      const uploadUrl = await generateUploadSasUrl(
        blobName,
        contentType || "video/webm"
      );

      return {
        uploadUrl,
        storageKey: blobName,
        expiresIn: UPLOAD_SAS_EXPIRY_MINUTES * 60, // Convert to seconds for API consistency
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
   * Get a SAS URL for uploading a frame sample
   */
  .post(
    "/frame-upload-url",
    async ({ body }) => {
      const { sessionId, timestamp } = body;

      // Generate unique storage key (blob name)
      const blobName = `frames/${sessionId}/${timestamp}-${nanoid(8)}.jpg`;

      const uploadUrl = await generateUploadSasUrl(blobName, "image/jpeg");

      return {
        uploadUrl,
        storageKey: blobName,
        expiresIn: UPLOAD_SAS_EXPIRY_MINUTES * 60,
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
   * Get a SAS URL for downloading a recording or frame
   */
  .get(
    "/download-url/:key",
    async ({ params }) => {
      const blobName = decodeURIComponent(params.key);

      const downloadUrl = await generateDownloadSasUrl(blobName);

      return {
        downloadUrl,
        expiresIn: DOWNLOAD_SAS_EXPIRY_MINUTES * 60,
      };
    },
    {
      params: t.Object({
        key: t.String(),
      }),
    }
  );
