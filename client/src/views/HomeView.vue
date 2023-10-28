<template>
  <main>
    <div class="upload-operate">
      <input type="file" @change="handleFileChange" />
      <el-button type="primary" @click="handleUpload">upload</el-button>
    </div>

    <div>
      <el-button v-if="state.status === 'pause'" type="primary" @click="handleResume"
        >resume</el-button
      >
      <el-button v-else type="primary" @click="handlePause">pause</el-button>
    </div>

    <div>
      <span>chunk hash: </span>
      <el-progress :percentage="state.hashPercentage"></el-progress>
    </div>

    <div>
      <span>total percentage: </span>
      <el-progress :percentage="state.fakeUploadPercentage"></el-progress>
    </div>

    <el-table :data="state.data">
      <el-table-column prop="hash" label="chunk hash" align="center"></el-table-column>
      <el-table-column label="size(KB)" align="center" width="120">
        <template v-slot="{ row }">
          {{ row.size / 1024 }}
        </template>
      </el-table-column>
      <el-table-column label="percentage" align="center">
        <template v-slot="{ row }">
          <el-progress :percentage="row.percentage" color="#909399"></el-progress>
        </template>
      </el-table-column>
    </el-table>
  </main>
</template>

<script setup lang="ts">
import { reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import axios, { type AxiosProgressEvent } from 'axios'

interface State {
  file: File | null
  data: Array<any>
  worker: Worker | null
  hashPercentage: number
  fileHash: string
  status: string
  fakeUploadPercentage: number
}
const state = reactive<State>({
  file: null,
  data: [],
  worker: null,
  hashPercentage: 0,
  fileHash: '',
  status: 'wait',
  fakeUploadPercentage: 0
})
const SIZE = 1 * 1024 * 1024 // chunk size 1MB
let controller: any = null

const uploadPercent = computed(() => {
  if (!state.file || !state.data.length) return 0
  const loaded = state.data
    .map((item) => item.size * item.percentage)
    .reduce((acc, cur) => {
      return acc + cur
    }, 0)
  console.log('loaded: ', loaded)
  return parseInt((loaded / state.file.size).toFixed(2))
})

watch(
  () => uploadPercent.value,
  (val: any) => {
    if (val > state.fakeUploadPercentage) {
      state.fakeUploadPercentage = val
    }
  }
)

function handleFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  state.file = file
}

async function handleUpload() {
  if (!state.file) return
  const chunkList = createFileChunk(state.file)
  state.fileHash = await calculateHash(chunkList)
  const { isUpload, uploadedList } = await verifyUpload(state.file.name, state.fileHash)
  if (isUpload) {
    ElMessage.success('文件已经上传')
    return
  }
  state.data = chunkList.map(({ file }, index) => {
    const hash = `${state.fileHash}-${index}`
    return {
      index,
      chunk: file,
      size: file.size,
      hash,
      fileHash: state.fileHash,
      percentage: uploadedList.includes(hash) ? 100 : 0
    }
  })
  await uploadChunk(uploadedList)
}

function createFileChunk(file: File, size = SIZE) {
  const chunkList = []
  let cur = 0
  while (cur < file.size) {
    chunkList.push({
      file: file.slice(cur, cur + size)
    })
    cur += size
  }
  return chunkList
}

function calculateHash(chunkList: any): Promise<string> {
  return new Promise((resolve) => {
    state.worker = new Worker('/hash.js')
    state.worker.postMessage({
      chunkList
    })
    state.worker.onmessage = (e) => {
      const { percentage, hash } = e.data
      state.hashPercentage = percentage
      if (hash) {
        resolve(hash)
      }
    }
  })
}

async function verifyUpload(filename: string, fileHash: string) {
  const { data } = await axios.post('http://localhost:3001/verify', {
    filename,
    fileHash
  })
  return data
}

async function uploadChunk(uploadedList = []) {
  controller = new AbortController()
  const requestList = state.data
    .filter((item: any) => !uploadedList.includes(item.hash))
    .map(({ chunk, hash, index }) => {
      const formData = new FormData()
      formData.append('chunk', chunk)
      formData.append('hash', hash)
      formData.append('fileHash', state.fileHash)
      formData.append('filename', state.file!.name)
      return { formData, index }
    })
    .map(({ formData, index }) =>
      axios.post('http://localhost:3001', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: createProgressHandler(state.data[index]),
        signal: controller.signal
      })
    )
  await Promise.all(requestList)
  await mergeRequest()
}

function createProgressHandler(item: any) {
  return (e: AxiosProgressEvent) => {
    if (e.total) {
      item.percentage = parseInt(String((e.loaded / e.total) * 100))
    }
  }
}

function mergeRequest() {
  return axios.post('http://localhost:3001/merge', {
    filename: state.file?.name,
    fileHash: state.fileHash,
    size: SIZE
  })
}

function handlePause() {
  state.status = 'pause'
  controller.abort()
  if (state.worker) {
    state.worker.onmessage = null
  }
}

async function handleResume() {
  state.status = 'uploading'
  const { uploadedList } = await verifyUpload(state.file!.name, state.fileHash)
  await uploadChunk(uploadedList)
}
</script>

<style>
.upload-operate {
  margin-bottom: 20px;
}
</style>
