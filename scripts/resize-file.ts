import * as readline from 'readline'
import * as fs from 'fs'
import { resize } from '../functions/resize'

const SRC_BUCKET = process.env.SRC_BUCKET || 'nftcom-dev-assets'
const DEST_BUCKET = process.env.DEST_BUCKET || 'nftcom-dev-assets-processed'
const RESIZE_WIDTH = process.env.RESIZE_WIDTH ? parseInt(process.env.RESIZE_WIDTH) : 600

const readInterface = readline.createInterface({
  input: fs.createReadStream('failed-out.txt'),
  output: process.stdout,
  terminal: false
})

const resizeFile = async () => {
  readInterface.on('line', async function (line) {
    try {
      const typeMatch = line.match(/\.([^.]*)$/)
      if (!typeMatch) {
        console.log(`Could not determine the image type. ${line}`)
        return
      }

      const imageType = typeMatch[1].toLowerCase()
      if (!['jpg', 'jpeg', 'gif', 'png', 'webp', 'svg'].includes(imageType)) {
        console.log(`Unsupported image type: ${imageType} from ${line}`)
        return
      }

      const dstKey = `${RESIZE_WIDTH}/${line}.webp`

      await resize(SRC_BUCKET, line, DEST_BUCKET, dstKey, imageType)
      await new Promise(r => setTimeout(r, 100))
    } catch (err) {
      console.log("Error in loop", err)
    }
  })
}

if (require.main === module) {
  resizeFile()
}