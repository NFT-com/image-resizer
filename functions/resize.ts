import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { Readable } from 'stream'
import * as sharp from 'sharp'
import * as fs from 'fs'

if (process.env.FAILED_FILE) {
  var failedStream = fs.createWriteStream(process.env.FAILED_FILE, {flags:'a'});
}

const REGION = process.env.REGION || 'us-east-1'
const s3 = new S3Client({ region: REGION })

const RESIZE_WIDTH = process.env.RESIZE_WIDTH ? parseInt(process.env.RESIZE_WIDTH) : 600

export const resize = async (srcBucket: string, srcKey: string, dstBucket: string, dstKey: string, imageType: string) => {
  try {
    const params = {
      Bucket: srcBucket,
      Key: srcKey
    }
    var origimage = await s3.send(new GetObjectCommand(params))

  } catch (error) {
    console.log(error, srcKey)
    process.env.FAILED_FILE ? failedStream.write(srcKey + '\n') : (()=>{})()
    return
  }

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
    outBuf = await sharp(inBuf, {
      animated: imageType === 'gif' ? true : undefined,
      limitInputPixels: false
    }).webp().resize(RESIZE_WIDTH).toBuffer()
  } catch (error) {
    console.log(error, srcKey)
    return
  }

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
    process.env.FAILED_FILE ? failedStream.write(srcKey + '\n') : (()=>{})()
    return
  }
}

exports.handler = async (event, context, callback) => {

  const srcBucket = event.Records[0].s3.bucket.name
  const srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "))
  const dstBucket = srcBucket + "-processed"
  const dstKey = `${RESIZE_WIDTH}/${srcKey}.webp`

  const typeMatch = srcKey.match(/\.([^.]*)$/)
  if (!typeMatch) {
    console.log("Could not determine the image type.")
    return
  }

  const imageType = typeMatch[1].toLowerCase()
  if (!['jpg', 'jpeg', 'gif', 'png', 'webp', 'svg'].includes(imageType)) {
    console.log(`Unsupported image type: ${imageType}`)
    return
  }

  await resize(srcBucket, srcKey, dstBucket, dstKey, imageType)
}
