import { S3Client, ListObjectsCommand } from '@aws-sdk/client-s3'
import { resize } from '../functions/resize'


const REGION = process.env.REGION || 'us-east-1'
const s3 = new S3Client({ region: REGION })

const SRC_BUCKET = process.env.SRC_BUCKET || 'nftcom-dev-assets'
const DEST_BUCKET = process.env.DEST_BUCKET || 'nftcom-dev-assets-processed'
const RESIZE_WIDTH = process.env.RESIZE_WIDTH ? parseInt(process.env.RESIZE_WIDTH) : 600

const bucketParams = { Bucket: SRC_BUCKET, Marker: undefined }

const resizeBucket = async () => {
  let truncated = true
  let pageMarker
  while (truncated) {
    try {
      const response = await s3.send(new ListObjectsCommand(bucketParams))
      response.Contents!.forEach(async (item) => {
        const typeMatch = item.Key!.match(/\.([^.]*)$/)
        if (!typeMatch) {
          console.log(`Could not determine the image type. ${item.Key}`)
          return
        }

        const imageType = typeMatch[1].toLowerCase()
        if (!['jpg', 'jpeg', 'gif', 'png', 'webp', 'svg'].includes(imageType)) {
          console.log(`Unsupported image type: ${imageType} from ${item.Key}`)
          return
        }

        const dstKey = `${RESIZE_WIDTH}/${item.Key}.webp`

        await resize(SRC_BUCKET, item.Key!, DEST_BUCKET, dstKey, imageType)
        await new Promise(r => setTimeout(r, 100));
      })
      truncated = response.IsTruncated!
      if (truncated) {
        pageMarker = response.Contents!.slice(-1)[0].Key
        bucketParams.Marker = pageMarker
      }
    } catch (err) {
      console.log("Error in loop", err)
      truncated = false
    }
  }
}

if (require.main === module) {
  resizeBucket()
}