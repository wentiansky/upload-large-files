const path = require('path')
const fse = require('fs-extra')
const multiparty = require('multiparty')

const UPLOAD_DIR = path.resolve(__dirname, '../target')

const getChunkDir = (fileHash) =>
  path.resolve(UPLOAD_DIR, `chunkDir_${fileHash}`)

const extractExt = (filename) =>
  filename.slice(filename.lastIndexOf('.'), filename.length)

const resolvePost = (req) => {
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

const createUploadedList = async (fileHash) => {
  const chunkDir = getChunkDir(fileHash)
  if (fse.existsSync(chunkDir)) {
    return await fse.readdir(chunkDir)
  }
  return []
}

const mergeChunk = async (filePath, fileHash, size) => {
  const chunkDir = getChunkDir(fileHash)
  let chunkPaths = await fse.readdir(chunkDir)
  // mac系统会出现 .DS_Store
  chunkPaths = chunkPaths.filter((item) => item !== '.DS_Store')
  // 根据切片下标排序
  chunkPaths.sort((a, b) => a.split('-')[1] - b.split('-')[1])

  // 并发写入文件
  await Promise.all(
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

const pipeStream = (chunkPath, writeStream) => {
  return new Promise((resolve) => {
    const readStream = fse.createReadStream(chunkPath)
    readStream.on('end', () => {
      // 删除切片
      // fse.unlinkSync(chunkPath)
      resolve()
    })
    // 使用pipe连接可读流和可写流
    readStream.pipe(writeStream)
  })
}

module.exports = class {
  async handleVerifyUpload(req, res) {
    const data = await resolvePost(req)
    const { filename, fileHash } = data
    const filePath = path.resolve(
      UPLOAD_DIR,
      `${fileHash}${extractExt(filename)}`
    )
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
          uploadedList: await createUploadedList(fileHash),
        })
      )
    }
  }

  async handleMerge(req, res) {
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

  async handleFormData(req, res) {
    // 注意: 这行代码要放在server.on的回调函数里面，不能放在文件顶部
    // 否则会出现 'stream ended unexpectedly' 报错
    const multipartyForm = new multiparty.Form()
    multipartyForm.parse(req, async (err, fields, files) => {
      if (err) {
        console.error(err)
        res.status = 500
        res.end(
          JSON.stringify({
            code: 500,
            message: 'process file chunk failed',
          })
        )
        return
      }
      const chunk = files.chunk[0]
      const hash = fields.hash[0]
      const fileHash = fields.fileHash[0]
      const filename = fields.filename[0]

      // 文件路径
      const filePath = path.resolve(
        UPLOAD_DIR,
        `${fileHash}${extractExt(filename)}`
      )
      // 创建临时文件夹存储 chunk
      const chunkDir = getChunkDir(fileHash)
      // 切片路径
      const chunkPath = path.resolve(chunkDir, hash)

      // 文件已存在，返回
      if (fse.existsSync(filePath)) {
        res.end(
          JSON.stringify({
            code: 0,
            message: 'file exist!',
          })
        )
        return
      }

      // 切片已存在，返回
      if (fse.existsSync(chunkPath)) {
        res.end(
          JSON.stringify({
            code: 0,
            message: 'chunk exist!',
          })
        )
        return
      }

      // 切片目录不存在，新建切片目录
      if (!fse.existsSync(chunkDir)) {
        await fse.mkdirs(chunkDir)
      }

      // fs-extra 的 rename 方法 windows 平台会有权限问题
      // use fs.move instead of fs.rename
      // https://github.com/meteor/meteor/issues/7852#issuecomment-255767835
      await fse.move(chunk.path, path.resolve(chunkDir, hash))
      res.end(
        JSON.stringify({
          code: 0,
          message: 'received file chunk',
        })
      )
    })
  }
}
