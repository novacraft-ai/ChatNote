/**
 * Google Drive Service
 * Handles all Drive API operations: upload, download, list, create folders, etc.
 */

import { Readable } from 'stream'
import { getDriveClient, refreshAccessToken } from './googleDriveAuth.js'

// In-memory cache for index.json to reduce API calls
// Key: userId, Value: { data, timestamp, chatNoteFolderId }
const indexCache = new Map()
const INDEX_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Get user ID from refresh token (for cache key)
 * Note: In a real app, you'd extract this from the token or pass it as a parameter
 * For now, we'll use a simple hash of the token
 */
function getCacheKey(refreshToken) {
  // Simple hash function for cache key
  let hash = 0
  for (let i = 0; i < refreshToken.length; i++) {
    const char = refreshToken.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return `index_${hash}`
}

/**
 * Clear index cache for a user (call when index is updated)
 */
export function clearIndexCache(refreshToken) {
  const key = getCacheKey(refreshToken)
  indexCache.delete(key)
}

/**
 * Find or create ChatNote folder structure
 * Returns: { chatNoteFolderId, pdfsFolderId, metadataFolderId }
 * Uses cached folder IDs from index.json to avoid repeated lookups
 */
export async function findOrCreateChatNoteFolders(refreshToken) {
  const drive = await getDriveClient(refreshToken)
  
  // Try to load cached folder IDs from index.json
  let cachedFolderIds = null
  try {
    // First, try to find ChatNote folder to get index.json
    const tempChatNoteFolderId = await findFolderByName('ChatNote', null, drive)
    if (tempChatNoteFolderId) {
      const indexData = await loadIndexFile(tempChatNoteFolderId, refreshToken)
      if (indexData.folderIds && 
          indexData.folderIds.chatNoteFolderId &&
          indexData.folderIds.pdfsFolderId &&
          indexData.folderIds.metadataFolderId) {
        cachedFolderIds = indexData.folderIds
      }
    }
  } catch (error) {
    // If we can't load index, continue without cache
  }
  
  // 1. Find or create ChatNote root folder
  let chatNoteFolderId = cachedFolderIds?.chatNoteFolderId || await findFolderByName('ChatNote', null, drive)
  
  if (!chatNoteFolderId) {
    const chatNoteFolder = await drive.files.create({
      requestBody: {
        name: 'ChatNote',
        mimeType: 'application/vnd.google-apps.folder'
      },
      fields: 'id'
    })
    chatNoteFolderId = chatNoteFolder.data.id
  }
  
  // 2. Find or create PDFs subfolder (use cache if available and valid)
  let pdfsFolderId = null
  if (cachedFolderIds?.pdfsFolderId) {
    // Verify cached ID is still valid by checking if folder exists
    try {
      const folder = await drive.files.get({
        fileId: cachedFolderIds.pdfsFolderId,
        fields: 'id, name'
      })
      if (folder.data.name === 'PDFs') {
        pdfsFolderId = cachedFolderIds.pdfsFolderId
      }
    } catch (error) {
      // Cached ID invalid, will look up
    }
  }
  
  if (!pdfsFolderId) {
    pdfsFolderId = await findFolderByName('PDFs', chatNoteFolderId, drive)
    if (!pdfsFolderId) {
      const pdfsFolder = await drive.files.create({
        requestBody: {
          name: 'PDFs',
          mimeType: 'application/vnd.google-apps.folder',
          parents: [chatNoteFolderId]
        },
        fields: 'id'
      })
      pdfsFolderId = pdfsFolder.data.id
    }
  }
  
  // 3. Find or create Metadata subfolder (use cache if available and valid)
  let metadataFolderId = null
  if (cachedFolderIds?.metadataFolderId) {
    // Verify cached ID is still valid
    try {
      const folder = await drive.files.get({
        fileId: cachedFolderIds.metadataFolderId,
        fields: 'id, name'
      })
      if (folder.data.name === 'Metadata') {
        metadataFolderId = cachedFolderIds.metadataFolderId
      }
    } catch (error) {
      // Cached ID invalid, will look up
    }
  }
  
  if (!metadataFolderId) {
    metadataFolderId = await findFolderByName('Metadata', chatNoteFolderId, drive)
    if (!metadataFolderId) {
      const metadataFolder = await drive.files.create({
        requestBody: {
          name: 'Metadata',
          mimeType: 'application/vnd.google-apps.folder',
          parents: [chatNoteFolderId]
        },
        fields: 'id'
      })
      metadataFolderId = metadataFolder.data.id
    }
  }
  
  // Cache folder IDs in index.json if they changed or weren't cached
  if (!cachedFolderIds || 
      cachedFolderIds.chatNoteFolderId !== chatNoteFolderId ||
      cachedFolderIds.pdfsFolderId !== pdfsFolderId ||
      cachedFolderIds.metadataFolderId !== metadataFolderId) {
    try {
      const indexData = await loadIndexFile(chatNoteFolderId, refreshToken)
      indexData.folderIds = {
        chatNoteFolderId,
        pdfsFolderId,
        metadataFolderId
      }
      await updateIndexFile(chatNoteFolderId, indexData, refreshToken)
    } catch (error) {
      // Don't fail if we can't cache - it's just an optimization
    }
  }
  
  return {
    chatNoteFolderId,
    pdfsFolderId,
    metadataFolderId
  }
}

/**
 * Find folder by name in parent folder
 */
async function findFolderByName(folderName, parentId, drive) {
  let query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  
  if (parentId) {
    query += ` and '${parentId}' in parents`
  } else {
    query += ` and parents in 'root'`
  }
  
  try {
    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      pageSize: 1
    })
    
    if (response.data.files && response.data.files.length > 0) {
      return response.data.files[0].id
    }
    return null
  } catch (error) {
    console.error('Error finding folder:', error)
    return null
  }
}

/**
 * Upload file to Drive
 * @param {string} folderId - Parent folder ID
 * @param {string} fileName - File name
 * @param {Buffer|string} fileContent - File content (Buffer for binary, string for JSON)
 * @param {string} mimeType - MIME type
 * @param {string} refreshToken - User's refresh token
 * @returns {Promise<string>} File ID
 */
export async function uploadFileToDrive(folderId, fileName, fileContent, mimeType, refreshToken) {
  const drive = await getDriveClient(refreshToken)
  
  // Check if file already exists
  const existingFile = await findFileByName(fileName, folderId, refreshToken)
  
  const fileMetadata = {
    name: fileName,
    parents: folderId ? [folderId] : undefined
  }
  
  let media
  if (Buffer.isBuffer(fileContent)) {
    // Convert Buffer to Stream (required by Google Drive API)
    const stream = Readable.from(fileContent)
    media = {
      mimeType: mimeType,
      body: stream
    }
  } else {
    // String content (JSON) - also convert to stream
    const stream = Readable.from([fileContent])
    media = {
      mimeType: mimeType,
      body: stream
    }
  }
  
  if (existingFile) {
    // Update existing file
    // Note: Cannot set 'parents' in update requests - remove it
    const { parents, ...updateMetadata } = fileMetadata
    const response = await drive.files.update({
      fileId: existingFile.id,
      requestBody: updateMetadata,
      media: media,
      fields: 'id'
    })
    return response.data.id
  } else {
    // Create new file
    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id'
    })
    return response.data.id
  }
}

/**
 * Find file by name in folder
 */
export async function findFileByName(fileName, folderId, refreshToken) {
  const drive = await getDriveClient(refreshToken)
  
  let query = `name='${fileName}' and trashed=false`
  
  if (folderId) {
    query += ` and '${folderId}' in parents`
  }
  
  try {
    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      pageSize: 1
    })
    
    if (response.data.files && response.data.files.length > 0) {
      return response.data.files[0]
    }
    return null
  } catch (error) {
    console.error('Error finding file:', error)
    return null
  }
}

/**
 * Download file from Drive
 * @param {string} fileId - Drive file ID
 * @param {string} refreshToken - User's refresh token
 * @returns {Promise<Buffer>} File content as Buffer
 */
export async function downloadFileFromDrive(fileId, refreshToken) {
  const drive = await getDriveClient(refreshToken)
  
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  )
  
  return Buffer.from(response.data)
}

/**
 * Download JSON file from Drive and parse it
 * @param {string} fileId - Drive file ID
 * @param {string} refreshToken - User's refresh token
 * @returns {Promise<object>} Parsed JSON object
 */
export async function downloadJsonFromDrive(fileId, refreshToken) {
  const buffer = await downloadFileFromDrive(fileId, refreshToken)
  return JSON.parse(buffer.toString('utf-8'))
}

/**
 * Load or create index.json file
 * Uses in-memory cache to reduce API calls
 * @param {string} chatNoteFolderId - ChatNote folder ID
 * @param {string} refreshToken - User's refresh token
 * @param {boolean} forceRefresh - Force refresh from Drive (skip cache)
 * @returns {Promise<object>} Index data
 */
export async function loadIndexFile(chatNoteFolderId, refreshToken, forceRefresh = false) {
  const cacheKey = getCacheKey(refreshToken)
  const now = Date.now()
  
  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = indexCache.get(cacheKey)
    if (cached && 
        cached.chatNoteFolderId === chatNoteFolderId &&
        (now - cached.timestamp) < INDEX_CACHE_TTL) {
      return cached.data
    }
  }
  
  // Load from Drive
  const indexFile = await findFileByName('index.json', chatNoteFolderId, refreshToken)
  
  let indexData
  if (indexFile) {
    indexData = await downloadJsonFromDrive(indexFile.id, refreshToken)
  } else {
    // Create empty index
    indexData = {
      version: 1,
      lastUpdated: Date.now(),
      pdfs: [],
      folderIds: null // Will be populated on first folder creation
    }
  }
  
  // Update cache
  indexCache.set(cacheKey, {
    data: indexData,
    timestamp: now,
    chatNoteFolderId
  })
  
  return indexData
}

/**
 * Update index.json file
 * Also updates in-memory cache
 * @param {string} chatNoteFolderId - ChatNote folder ID
 * @param {object} indexData - Index data to save
 * @param {string} refreshToken - User's refresh token
 */
export async function updateIndexFile(chatNoteFolderId, indexData, refreshToken) {
  indexData.lastUpdated = Date.now()
  const indexJson = JSON.stringify(indexData, null, 2)
  
  await uploadFileToDrive(
    chatNoteFolderId,
    'index.json',
    indexJson,
    'application/json',
    refreshToken
  )
  
  // Update cache
  const cacheKey = getCacheKey(refreshToken)
  indexCache.set(cacheKey, {
    data: indexData,
    timestamp: Date.now(),
    chatNoteFolderId
  })
}

/**
 * Add or update PDF entry in index
 * @param {string} chatNoteFolderId - ChatNote folder ID
 * @param {object} pdfEntry - PDF entry data
 * @param {string} refreshToken - User's refresh token
 */
export async function updateIndexFileEntry(chatNoteFolderId, pdfEntry, refreshToken) {
  const indexData = await loadIndexFile(chatNoteFolderId, refreshToken)
  
  // Find existing entry
  const existingIndex = indexData.pdfs.findIndex(p => p.pdfId === pdfEntry.pdfId)
  
  if (existingIndex >= 0) {
    // Update existing
    indexData.pdfs[existingIndex] = { ...indexData.pdfs[existingIndex], ...pdfEntry }
  } else {
    // Add new
    indexData.pdfs.push(pdfEntry)
  }
  
  // Sort by lastModifiedAt (newest first)
  indexData.pdfs.sort((a, b) => b.lastModifiedAt - a.lastModifiedAt)
  
  await updateIndexFile(chatNoteFolderId, indexData, refreshToken)
}

/**
 * Get user's PDF history from index
 * @param {string} refreshToken - User's refresh token
 * @returns {Promise<Array>} List of PDF entries
 */
export async function getPdfHistory(refreshToken) {
  const { chatNoteFolderId } = await findOrCreateChatNoteFolders(refreshToken)
  const indexData = await loadIndexFile(chatNoteFolderId, refreshToken)
  const history = indexData.pdfs.map(pdf => ({
    pdfId: pdf.pdfId,
    displayName: pdf.displayName,
    originalFileName: pdf.originalFileName,
    uploadedAt: pdf.uploadedAt,
    lastModifiedAt: pdf.lastModifiedAt,
    pageCount: pdf.pageCount,
    hasAnnotations: pdf.hasAnnotations || false,
    hasNotes: pdf.hasNotes || false
  }))

  return history
}

/**
 * Delete multiple files from Drive, ignoring missing files.
 */
export async function deleteFilesFromDrive(fileIds = [], refreshToken) {
  if (!fileIds || fileIds.length === 0) {
    return
  }

  const drive = await getDriveClient(refreshToken)
  for (const fileId of fileIds) {
    if (!fileId) continue
    try {
      await drive.files.delete({ fileId })
    } catch (error) {
      console.warn('Failed to delete Drive file:', fileId, error.message)
    }
  }
}

/**
 * Remove a PDF entry from index.json and return the removed entry.
 */
export async function removePdfFromIndex(chatNoteFolderId, pdfId, refreshToken) {
  const indexData = await loadIndexFile(chatNoteFolderId, refreshToken)
  const existingIndex = indexData.pdfs.findIndex(pdf => pdf.pdfId === pdfId)

  if (existingIndex === -1) {
    return null
  }

  const [removedEntry] = indexData.pdfs.splice(existingIndex, 1)
  await updateIndexFile(chatNoteFolderId, indexData, refreshToken)
  return removedEntry
}

/**
 * Truncate file name for display
 */
export function truncateFileName(fileName, maxLength = 30) {
  if (fileName.length <= maxLength) return fileName
  return fileName.substring(0, maxLength - 3) + '...'
}

/**
 * Generate unique PDF ID
 */
export function generatePdfId() {
  return `pdf_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

