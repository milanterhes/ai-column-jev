import { existsSync } from "node:fs"
import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3"
import { NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"

/**
 * One-time object-storage bootstrap: configure CORS on the local Garage
 * bucket so the browser can PUT to (upload) and GET from (download) the
 * presigned URLs directly. The `garage` compose service auto-provisions the
 * bucket and keys, but not the bucket's CORS rules, and Garage does not accept
 * CORS via its config file — only through the S3 CORS endpoints.
 *
 * Idempotent: re-running simply re-applies the same rules.
 */
if (existsSync(".env")) {
  process.loadEnvFile(".env")
}

const localStorageBucket = process.env.STORAGE_BUCKET
const localStorageEndpoint = process.env.STORAGE_ENDPOINT
const localStorageRegion = process.env.STORAGE_REGION
const localStorageAccessKey = process.env.STORAGE_ACCESS_KEY_ID
const localStorageSecret = process.env.STORAGE_SECRET_ACCESS_KEY

if (
  localStorageBucket === undefined ||
  localStorageEndpoint === undefined ||
  localStorageRegion === undefined ||
  localStorageAccessKey === undefined ||
  localStorageSecret === undefined
) {
  throw new Error(
    "Missing STORAGE_* env vars. Copy .env.example to .env (the docker-compose Garage service provisions the matching bucket/keys), then re-run."
  )
}

const program = Effect.tryPromise(() =>
  new S3Client({
    endpoint: localStorageEndpoint,
    region: localStorageRegion,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: localStorageAccessKey,
      secretAccessKey: localStorageSecret
    }
  }).send(
    new PutBucketCorsCommand({
      Bucket: localStorageBucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: ["*"],
            AllowedMethods: ["GET", "PUT", "DELETE", "HEAD"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3600
          }
        ]
      }
    })
  )
).pipe(Effect.tap(() => Effect.log(`CORS configured on bucket "${localStorageBucket}"`)))

NodeRuntime.runMain(program)