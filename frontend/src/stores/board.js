import { defineStore } from 'pinia'
import { ref } from 'vue'
import { boardApi, columnApi, cardApi } from '../api/index.js'

export const useBoardStore = defineStore('board', () => {
  const boards = ref([])
  const currentBoard = ref(null)
  const columns = ref([])
  const cards = ref({}) // keyed by columnId -> [cards]
  const loading = ref(false)

  // Board actions
  async function fetchBoards() {
    loading.value = true
    try {
      const res = await boardApi.list()
      boards.value = res.data
    } finally {
      loading.value = false
    }
  }

  async function createBoard(name, description) {
    const res = await boardApi.create(name, description)
    boards.value.unshift(res.data)
    return res.data
  }

  async function deleteBoard(id) {
    await boardApi.delete(id)
    boards.value = boards.value.filter(b => b.id !== id)
  }

  // Column actions
  async function fetchColumns(boardId) {
    loading.value = true
    try {
      const res = await columnApi.list(boardId)
      columns.value = res.data
      // Initialize cards map
      cards.value = {}
      for (const col of res.data) {
        cards.value[col.id] = []
      }
    } finally {
      loading.value = false
    }
  }

  async function addColumn(boardId, name) {
    const res = await columnApi.create(boardId, name)
    columns.value.push(res.data)
    cards.value[res.data.id] = []
    return res.data
  }

  async function renameColumn(colId, name) {
    const res = await columnApi.update(colId, { name })
    const idx = columns.value.findIndex(c => c.id === colId)
    if (idx !== -1) columns.value[idx] = res.data
    return res.data
  }

  async function deleteColumn(colId) {
    await columnApi.delete(colId)
    columns.value = columns.value.filter(c => c.id !== colId)
    delete cards.value[colId]
  }

  async function reorderColumn(colId, newPosition) {
    const res = await columnApi.update(colId, { position: newPosition })
    // Refresh columns to get correct order
    if (currentBoard.value) {
      await fetchColumns(currentBoard.value.id)
    }
    return res.data
  }

  // Card actions
  async function fetchCards(columnId) {
    const res = await cardApi.list(columnId)
    cards.value[columnId] = res.data
    return res.data
  }

  async function fetchAllCards(boardId) {
    // Fetch cards for all columns in parallel
    const cols = columns.value
    const promises = cols.map(col => cardApi.list(col.id))
    const results = await Promise.all(promises)
    cols.forEach((col, i) => {
      cards.value[col.id] = results[i].data
    })
  }

  async function addCard(columnId, data) {
    const res = await cardApi.create(columnId, data)
    if (!cards.value[columnId]) cards.value[columnId] = []
    cards.value[columnId].push(res.data)
    return res.data
  }

  async function updateCard(cardId, data) {
    const res = await cardApi.update(cardId, data)
    // Update card in the local state
    for (const colId in cards.value) {
      const idx = cards.value[colId].findIndex(c => c.id === cardId)
      if (idx !== -1) {
        cards.value[colId][idx] = res.data
        break
      }
    }
    return res.data
  }

  async function deleteCard(cardId) {
    await cardApi.delete(cardId)
    for (const colId in cards.value) {
      cards.value[colId] = cards.value[colId].filter(c => c.id !== cardId)
    }
  }

  // Single state transition for moving a card.
  // Both entry points (drag & drop and the detail dialog) go through this,
  // so source column, target column, counts and positions can never diverge.
  async function moveCard(cardId, targetColumnId, position) {
    // Locate the card in whatever column the local state currently has it.
    let sourceColumnId = null
    let sourceIndex = -1
    for (const colId in cards.value) {
      const idx = cards.value[colId].findIndex(c => c.id === cardId)
      if (idx !== -1) {
        sourceColumnId = colId
        sourceIndex = idx
        break
      }
    }

    // Snapshot every column before touching state so a failed move can be
    // fully restored (including columns that did not previously exist in the map).
    const snapshot = {}
    const knownKeys = Object.keys(cards.value)
    for (const colId of knownKeys) {
      snapshot[colId] = cards.value[colId].map(c => ({ ...c }))
    }
    if (cards.value[targetColumnId] === undefined) {
      cards.value[targetColumnId] = []
    }

    try {
      // Optimistic move: one remove + one insert keeps both column counts
      // (tags derive from list length) and list order in sync immediately.
      let movedCard = null
      if (sourceColumnId !== null) {
        movedCard = cards.value[sourceColumnId].splice(sourceIndex, 1)[0]
      }
      if (movedCard) {
        const targetList = cards.value[targetColumnId]
        const insertAt = Math.max(0, Math.min(position ?? targetList.length, targetList.length))
        targetList.splice(insertAt, 0, movedCard)
      }

      // Persist with retries for transient failures (network errors / 5xx).
      const res = await withMoveRetry(() => cardApi.move(cardId, targetColumnId, position))
      const serverCard = res.data

      // Reconcile with the authoritative server result. Positions are shared
      // across callers, so both entries always end up showing the same values.
      const targetList = cards.value[targetColumnId]
      let targetIndex = targetList.findIndex(c => c.id === cardId)
      if (targetIndex === -1) {
        // Card was missing from local state (e.g. stale page); trust the server.
        const insertAt = Math.max(0, Math.min(serverCard.position ?? 0, targetList.length))
        targetList.splice(insertAt, 0, serverCard)
        targetIndex = insertAt
      } else {
        targetList[targetIndex] = serverCard
      }
      // Renumber positions to match array order, mirroring the server-side shift.
      targetList.forEach((card, i) => { card.position = i })
      if (sourceColumnId !== null && String(sourceColumnId) !== String(targetColumnId)) {
        cards.value[sourceColumnId].forEach((card, i) => { card.position = i })
      }
      return serverCard
    } catch (err) {
      // Failure recovery: restore every column from the snapshot in one place.
      for (const colId of Object.keys(cards.value)) {
        if (snapshot[colId] === undefined) {
          delete cards.value[colId]
        } else {
          cards.value[colId] = snapshot[colId]
        }
      }
      throw err
    }
  }

  // Retry the move request only on errors that might succeed on a second try.
  async function withMoveRetry(request, attempt = 1) {
    const maxAttempts = 3
    try {
      return await request()
    } catch (err) {
      const status = err.response?.status
      const retriable = !err.response || (status >= 500 && status < 600)
      if (!retriable || attempt >= maxAttempts) throw err
      await new Promise(resolve => setTimeout(resolve, 300 * attempt))
      return withMoveRetry(request, attempt + 1)
    }
  }

  function clearBoard() {
    currentBoard.value = null
    columns.value = []
    cards.value = {}
  }

  return {
    boards, currentBoard, columns, cards, loading,
    fetchBoards, createBoard, deleteBoard,
    fetchColumns, addColumn, renameColumn, deleteColumn, reorderColumn,
    fetchCards, fetchAllCards, addCard, updateCard, deleteCard, moveCard,
    clearBoard
  }
})
