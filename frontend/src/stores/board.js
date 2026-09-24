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

  // Renumber a column's cards so each local position matches its index.
  function renumberPositions(list) {
    list.forEach((card, i) => {
      card.position = i
    })
  }

  // Single state-update path for a card move, shared by drag-and-drop, the
  // card menu and the detail dialog: optimistic local update (source column,
  // target column, counts and positions), rollback snapshot on failure, and
  // server-authoritative result on success.
  async function moveCard(cardId, targetColumnId, position) {
    targetColumnId = Number(targetColumnId)

    // Locate the card in its current source column.
    let sourceColumnId = null
    let sourceIndex = -1
    let movedCard = null
    for (const colId in cards.value) {
      const idx = cards.value[colId].findIndex(c => c.id === cardId)
      if (idx !== -1) {
        sourceColumnId = Number(colId)
        sourceIndex = idx
        movedCard = cards.value[colId][idx]
        break
      }
    }
    if (!movedCard) {
      throw new Error('Card not found')
    }

    const sameColumn = sourceColumnId === targetColumnId
    const requestedPosition = Number.isFinite(Number(position)) ? Number(position) : null

    // Snapshot both affected columns so the optimistic update can be undone.
    const sourceSnapshot = [...cards.value[sourceColumnId]]
    const targetExisted = Object.prototype.hasOwnProperty.call(cards.value, targetColumnId)
    const targetSnapshot = targetExisted && !sameColumn ? [...cards.value[targetColumnId]] : null
    const originalColumnId = movedCard.column_id
    const originalPosition = movedCard.position
    // Renumbering mutates shared card objects, so remember every old position.
    const positionSnapshot = new Map()
    const rememberPositions = list => list.forEach(c => positionSnapshot.set(c.id, c.position))
    rememberPositions(sourceSnapshot)
    if (targetSnapshot) rememberPositions(targetSnapshot)

    // Optimistic update: remove from the source, insert at the (clamped)
    // target position and renumber both columns the same way the server does.
    const sourceList = cards.value[sourceColumnId]
    sourceList.splice(sourceIndex, 1)
    if (!cards.value[targetColumnId]) cards.value[targetColumnId] = []
    const targetList = cards.value[targetColumnId]
    let insertAt = requestedPosition === null ? targetList.length : requestedPosition
    insertAt = Math.max(0, Math.min(insertAt, targetList.length))
    targetList.splice(insertAt, 0, movedCard)
    movedCard.column_id = targetColumnId
    movedCard.position = insertAt
    renumberPositions(sameColumn ? targetList : sourceList)
    renumberPositions(targetList)

    try {
      const res = await cardApi.move(cardId, targetColumnId, insertAt)
      // Trust the server result: the moved card lands at the server-assigned
      // position (it may clamp a different index), so place it there before
      // renumbering every other card's local position to match the order.
      const updated = res.data
      const finalList = cards.value[targetColumnId]
      const currentIndex = finalList.findIndex(c => c.id === cardId)
      const merged = { ...(currentIndex !== -1 ? finalList[currentIndex] : {}), ...updated }
      if (currentIndex !== -1) finalList.splice(currentIndex, 1)
      const serverPosition = Number.isFinite(Number(merged.position))
        ? Math.max(0, Math.min(Number(merged.position), finalList.length))
        : finalList.length
      finalList.splice(serverPosition, 0, merged)
      renumberPositions(finalList)
      if (!sameColumn && cards.value[sourceColumnId]) {
        renumberPositions(cards.value[sourceColumnId])
      }
      return updated
    } catch (err) {
      // Restore the pre-move state so callers can offer a clean retry.
      const restorePositions = list => list.forEach(c => {
        if (positionSnapshot.has(c.id)) c.position = positionSnapshot.get(c.id)
      })
      if (sameColumn) {
        cards.value[sourceColumnId] = sourceSnapshot
        restorePositions(sourceSnapshot)
      } else {
        cards.value[sourceColumnId] = sourceSnapshot
        restorePositions(sourceSnapshot)
        if (targetSnapshot) {
          cards.value[targetColumnId] = targetSnapshot
          restorePositions(targetSnapshot)
        } else {
          delete cards.value[targetColumnId]
        }
      }
      movedCard.column_id = originalColumnId
      movedCard.position = originalPosition
      throw err
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
