// dependencies
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { Readable } from 'stream'
import { inspect } from 'util'
import * as sharp from 'sharp'

// get reference to S3 client
const REGION = process.env.REGION || 'us-east-1'
const s3 = new S3Client({ region: REGION })

const RESIZE_WIDTH = process.env.RESIZE_WIDTH ? parseInt(process.env.RESIZE_WIDTH) : 600

export const resize = async (srcBucket, srcKey, dstBucket, dstKey, imageType) => {
  // Download the image from the S3 source bucket.

  try {
    const params = {
      Bucket: srcBucket,
      Key: srcKey
    }
    var origimage = await s3.send(new GetObjectCommand(params))

  } catch (error) {
    console.log(error, srcKey)
    return
  }

  // Use the sharp module to resize the image and save in a buffer.
  if (!origimage.ContentLength) {
    return // empty object from s3
  }

  let outBuf
  try {
    const inBuf = await new Promise<Buffer>((resolve, reject) => {
      const stream = origimage.Body as Readable
      const chunks: Buffer[] = []
      stream.on('data', chunk => chunks.push(chunk))
      stream.once('end', () => resolve(Buffer.concat(chunks)))
      stream.once('error', reject)
    })
    if (imageType === 'gif') {
      outBuf = await sharp(inBuf, {animated: true}).webp().resize(RESIZE_WIDTH).toBuffer()
    } else {
      outBuf = await sharp(inBuf).webp().resize(RESIZE_WIDTH).toBuffer()
    }
  } catch (error) {
    console.log(error, srcKey)
    return
  }

  // Upload the thumbnail image to the destination bucket
  try {
    const destparams = {
      Bucket: dstBucket,
      Key: dstKey,
      Body: outBuf,
      ContentType: 'image/webp'
    }

    const putResult = await s3.send(new PutObjectCommand(destparams))

  } catch (error) {
    console.log(error, srcKey)
    return
  }
}

exports.handler = async (event, context, callback) => {

  // Read options from the event parameter.
  console.log("Reading options from event:\n", inspect(event, { depth: 5 }))
  const srcBucket = event.Records[0].s3.bucket.name
  // Object key may have spaces or unicode non-ASCII characters.
  const srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "))
  const dstBucket = srcBucket + "-processed"
  const dstKey = `${RESIZE_WIDTH}/${srcKey}.webp`

  // Infer the image type from the file suffix.
  const typeMatch = srcKey.match(/\.([^.]*)$/)
  if (!typeMatch) {
    console.log("Could not determine the image type.")
    return
  }

  // Check that the image type is supported
  const imageType = typeMatch[1].toLowerCase()
  if (!['jpg', 'jpeg', 'gif', 'png', 'webp', 'svg'].includes(imageType)) {
    console.log(`Unsupported image type: ${imageType}`)
    return
  }

  await resize(srcBucket, srcKey, dstBucket, dstKey, imageType)
}
