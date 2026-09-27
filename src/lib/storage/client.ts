import "server-only";

import { S3Client } from "@aws-sdk/client-s3";

import { env } from "@/config/env";

const storageConfig = {
  endpoint: env.STORAGE_ENDPOINT_URL,
  region: env.STORAGE_REGION,
  accessKeyId: env.STORAGE_ACCESS_KEY_ID,
  secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
};

if (
  !storageConfig.endpoint ||
  !storageConfig.region ||
  !storageConfig.accessKeyId ||
  !storageConfig.secretAccessKey
) {
  throw new Error("Storage configuration is incomplete.");
}

export const storageClient = new S3Client({
  endpoint: storageConfig.endpoint,
  region: storageConfig.region,
  credentials: {
    accessKeyId: storageConfig.accessKeyId,
    secretAccessKey: storageConfig.secretAccessKey,
  },
  forcePathStyle: true,
});