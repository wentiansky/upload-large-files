const http = require('http')
const server = http.createServer()
const fse = require('fs-extra')
const path = require('path')
const multiparty = require('multiparty')
const UPLOAD_DIR = path.resolve(__dirname, '../target')

function resolvePost(req) {
  return new Promise((resolve) => {
    let chunk = ''
    req.on('data', (data) => {
      chunk += data
    })
    req.on('end', () => {
      resolve(JSON.parse(chunk))
    })
  })
}

function extractExt(filename) {
  return filename.slice(filename.lastIndexOf('.'), filename.length)
}

/**
 * 写入文件流
 */
function pipeStream(filePath, writeStream) {
  return new Promise((resolve) => {
    const readStream = fse.createReadStream(filePath)
    readStream.on('end', () => {
      // 删除切片
      // fse.unlinkSync(filePath)
      resolve()
    })
    readStream.pipe(writeStream)
  })
}

/**
 * 合并切片
 */
async function mergeChunk(filePath, fileHash, size) {
  const chunkDir = path.resolve(UPLOAD_DIR, `chunkDir_${fileHash}`)
  const chunkPaths = await fse.readdir(chunkDir)
  // 根据切片下标排序
  chunkPaths.sort((a, b) => a.split('-')[1] - b.split('-')[1])
  // 并发写入文件
  await Promise.allSettled(
    chunkPaths.map((chunkPath, index) =>
      pipeStream(
        path.resolve(chunkDir, chunkPath),
        fse.createWriteStream(filePath, {
          start: index * size,
        })
      )
    )
  )
  // 合并后删除保存切片的目录
  // fse.rmdirSync(chunkDir)
}

server.on('request', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  if (req.method === 'OPTIONS') {
    res.status = 200
    res.end()
    return
  }

  if (req.url === '/') {
    // 注意: 这行代码要放在server.on的回调函数里面，不能放在文件顶部
    // 否则会出现 'stream ended unexpectedly' 报错
    const multipartyForm = new multiparty.Form()

    multipartyForm.parse(req, async (err, fields, files) => {
      if (err) {
        console.error(err)
        res.status = 500
        res.end('process file chunk failed')
        return
      }
      const chunk = files.chunk[0]
      const hash = fields.hash[0]
      const fileHash = fields.fileHash[0]
      const filename = fields.filename[0]
      // 创建临时文件夹存储 chunk
      const chunkDir = path.resolve(UPLOAD_DIR, `chunkDir_${fileHash}`)
      if (!fse.existsSync(chunkDir)) {
        await fse.mkdirs(chunkDir)
      }
      await fse.move(chunk.path, path.resolve(chunkDir, hash))
      res.end('received file chunk')
    })
  }

  if (req.url === '/verify') {
    const data = await resolvePost(req)
    const { filename, fileHash } = data
    const ext = extractExt(filename)
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`)
    if (fse.existsSync(filePath)) {
      res.end(
        JSON.stringify({
          code: 0,
          isUpload: true,
        })
      )
    } else {
      res.end(
        JSON.stringify({
          code: 0,
          isUpload: false,
        })
      )
    }
  }

  if (req.url === '/merge') {
    const data = await resolvePost(req)
    const { filename, size, fileHash } = data
    const filePath = path.resolve(
      UPLOAD_DIR,
      `${fileHash}${extractExt(filename)}`
    )
    await mergeChunk(filePath, fileHash, size)
    res.end(
      JSON.stringify({
        code: 0,
        message: 'merge success',
      })
    )
  }
})

server.listen(3001, () => {
  console.log('listening port 3001:')
})
