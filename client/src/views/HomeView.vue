<template>
  <main>
    <input type="file" @change="handleFileChange" />
    <el-button @click="handleUpload">upload</el-button>
  </main>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import axios from 'axios'

interface State {
  file: File | null
  data: Array<any>
}
const state = reactive<State>({
  file: null,
  data: []
})
const SIZE = 1 * 1024 * 1024

function handleFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  state.file = file
}

/**
 * 生成切片
 */
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

async function handleUpload() {
  if (!state.file) return
  const chunkList = createFileChunk(state.file)
  state.data = chunkList.map((chunk, index) => {
    return {
      chunk: chunk.file,
      hash: `${state.file?.name}-${index}`
    }
  })
  await uploadChunk()
}

/**
 * 上传切片
 */
async function uploadChunk() {
  const requestList = state.data
    .map(({ chunk, hash }) => {
      const formData = new FormData()
      formData.append('chunk', chunk)
      formData.append('hash', hash)
      formData.append('filename', state.file!.name)
      return { formData }
    })
    .map(({ formData }) =>
      axios.post('http://localhost:3001', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })
    )
  await Promise.allSettled(requestList)
  console.log('已上传全部切片')
  await mergeRequest()
}

function mergeRequest() {
  return axios.post('http://localhost:3001/merge', {
    filename: state.file?.name,
    size: SIZE
  })
}
</script>
