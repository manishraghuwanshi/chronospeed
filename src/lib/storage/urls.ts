import "server-only";

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "@/config/env";
import { storageClient } from "@/lib/storage/client";

export async function getStorageObjectUrl(
  storageKey: string | null,
): Promise<string | null> {
  if (!storageKey) {
    return null;
  }

  const command = new GetObjectCommand({
    Bucket: env.STORAGE_BUCKET,
    Key: storageKey,
  });

  return getSignedUrl(storageClient, command, {
    expiresIn: env.STORAGE_SIGNED_URL_TTL_SECONDS,
  });
}
