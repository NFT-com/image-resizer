import { S3Client, GetObjectCommand, PutObjectCommand, GetObjectCommandOutput } from '@aws-sdk/client-s3'
import { Readable } from 'stream'
import { parse } from 'svgson'
import { convert } from 'convert-svg-to-webp'
import * as sharp from 'sharp'
import * as fs from 'fs'

if (process.env.FAILED_FILE) {
  var failedStream = fs.createWriteStream(process.env.FAILED_FILE, {flags:'a'});
}

const REGION = process.env.REGION || 'us-east-1'
const s3 = new S3Client({ region: REGION })

const RESIZE_WIDTH = process.env.RESIZE_WIDTH ? parseInt(process.env.RESIZE_WIDTH) : 600

const hasAnimateChild = (children) => {
  if (!children.length) {
    return false
  }
  return children.some(child => child.name === 'animate') || hasAnimateChild(children.reduce((children, child) => children.concat(child.children), []))
}

const isAnimatedSVGBuffer = async (imageBuf: Buffer) => {
  const svg = await parse(imageBuf.toString('utf-8'))
  const base64Prefix = 'data:image/svg+xml;base64'
  const base64Imgs = svg.children.filter(child => child.attributes.href.indexOf(base64Prefix) !== -1)
  for (let img of base64Imgs) {
    const xml = await parse(Buffer.from(img.attributes.href.substring(base64Prefix.length+1), 'base64').toString('utf-8'))
    return hasAnimateChild(xml.children)
  }
  return false
}

const isAnimatedSVG = async (imageType: string, imageBuf: Buffer) => {
  return imageType === 'svg' && isAnimatedSVGBuffer(imageBuf)
}

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

  let inBuf, outBuf
  try {
    inBuf = await new Promise<Buffer>((resolve, reject) => {
      const stream = origimage.Body as Readable
      const chunks: Buffer[] = []
      stream.on('data', chunk => chunks.push(chunk))
      stream.once('end', () => resolve(Buffer.concat(chunks)))
      stream.once('error', reject)
    })

    if (isAnimatedSVG(imageType, inBuf)) {
      inBuf = await convert(inBuf)
    }
    outBuf = await sharp(inBuf, {
      animated: imageType === 'gif' ? true : undefined,
      limitInputPixels: false
    }).timeout({ seconds: 14 }).webp().resize(RESIZE_WIDTH).toBuffer()
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
    console.log(putResult)

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
