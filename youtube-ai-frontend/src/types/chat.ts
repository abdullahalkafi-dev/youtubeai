export type ThreadType = 'video' | 'standalone'
export type ThreadCategory = 'general' | 'script' | 'seo' | 'thumbnail' | 'image' | 'competitor' | 'trends' | 'ideas' | 'outline'
export type ThreadStatus = 'active' | 'archived'

export interface ChatImage {
  id: string
  url: string
  cleanBackgroundUrl?: string
  prompt: string
  conceptTitle?: string
  textOverlay?: string
  visualDescription?: string
  selectedHostImage?: string
  mode?: 'thumbnail' | 'scene'
  isSceneImage?: boolean
  createdAt: string
}

export interface ChatSource {
  title: string
  url: string
  snippet?: string
}

export interface ChatAttachment {
  type: 'pdf' | 'image'
  url: string
  filename: string
  extractedText?: string
}

export interface Message {
  id: string
  _id?: string
  threadId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  metadata?: {
    category?: string
    generatedSeo?: {
      title: string
      description: string
      tags: string[]
    }
    generatedScript?: string
    scriptId?: string
    thumbnailConcept?: string
    images?: ChatImage[]
    sources?: ChatSource[]
    attachments?: ChatAttachment[]
  }
}

export interface Thread {
  id: string
  channelId: string
  type: ThreadType
  title: string
  status: ThreadStatus
  videoId?: string
  videoTitle?: string
  videoThumbnail?: string
  summary?: string | null
  totalPromptTokens: number
  totalCompletionTokens: number
  totalCachedTokens: number
  messages: Message[]
  createdAt: string
  updatedAt: string
}

export interface ThreadListItem {
  id: string
  channelId: string
  type: ThreadType
  title: string
  status: ThreadStatus
  videoId?: string
  videoTitle?: string
  videoThumbnail?: string
  summary?: string | null
  totalPromptTokens: number
  totalCompletionTokens: number
  totalCachedTokens: number
  messageCount: number
  createdAt: string
  updatedAt: string
}

export type SendMessageResponse =
  | Message
  | { error: string; threadId: string; archived: true }
