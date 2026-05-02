import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

let _client: S3Client | null = null;
let _bucket: string | null = null;

function client(): S3Client {
  if (_client) return _client;
  // Prefer R2_PUBLIC_URL when set (custom domain → served via Cloudflare CDN).
  // Presigned URLs include the host in the signature, so we must sign
  // against the same host the browser will request.
  //
  // Path-style is required even for custom domains: virtual-host style would
  // prepend the bucket name to the host (`files.files-cdn.arthur-trt.fr`),
  // doubling it. With path-style the URL is `files-cdn.arthur-trt.fr/<bucket>/<key>`
  // — Cloudflare's custom-domain proxy strips the bucket prefix transparently
  // when it maps the request to R2.
  const publicUrl = process.env.R2_PUBLIC_URL;
  const endpoint =
    publicUrl && publicUrl.length > 0
      ? publicUrl
      : `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
  _client = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    },
    forcePathStyle: true,
  });
  return _client;
}

function bucket(): string {
  if (_bucket) return _bucket;
  _bucket = required("R2_BUCKET");
  return _bucket;
}

const PUT_TTL_SECONDS = 15 * 60;
const GET_TTL_SECONDS = 60 * 60;
const PART_TTL_SECONDS = 30 * 60;

export function transferKey(transferId: string, name: string): string {
  return `transfers/${transferId}/${name}`;
}

export async function presignPut(key: string): Promise<string> {
  const cmd = new PutObjectCommand({ Bucket: bucket(), Key: key });
  return getSignedUrl(client(), cmd, { expiresIn: PUT_TTL_SECONDS });
}

export async function presignGet(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket(), Key: key });
  return getSignedUrl(client(), cmd, { expiresIn: GET_TTL_SECONDS });
}

export async function createMultipart(key: string): Promise<string> {
  const out = await client().send(
    new CreateMultipartUploadCommand({ Bucket: bucket(), Key: key }),
  );
  if (!out.UploadId) throw new Error("R2: no UploadId returned");
  return out.UploadId;
}

export async function presignUploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
): Promise<string> {
  const cmd = new UploadPartCommand({
    Bucket: bucket(),
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  return getSignedUrl(client(), cmd, { expiresIn: PART_TTL_SECONDS });
}

export async function completeMultipart(
  key: string,
  uploadId: string,
  parts: { PartNumber: number; ETag: string }[],
): Promise<void> {
  await client().send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }),
  );
}

export async function abortMultipart(
  key: string,
  uploadId: string,
): Promise<void> {
  await client().send(
    new AbortMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      UploadId: uploadId,
    }),
  );
}

export async function headObject(key: string): Promise<boolean> {
  try {
    await client().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function deletePrefix(prefix: string): Promise<number> {
  let total = 0;
  let continuationToken: string | undefined;
  do {
    const list = await client().send(
      new ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const keys = list.Contents?.map((o) => o.Key!).filter(Boolean) ?? [];
    if (keys.length) {
      await client().send(
        new DeleteObjectsCommand({
          Bucket: bucket(),
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );
      total += keys.length;
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);
  return total;
}

export async function deleteObject(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
