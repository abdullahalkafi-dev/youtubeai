export interface ScriptVersionItem {
  _id?: string;
  id?: string;
  scriptId: string;
  versionNumber: number;
  title: string;
  content: string;
  blocks?: any[];
  wordCount: number;
  estimatedDurationMinutes: number;
  changeDescription?: string;
  createdBy: 'ai_generated' | 'user_edit' | 'manual_import' | 'restored_version';
  userId?: string;
  createdAt: string;
}

export interface ScriptItem {
  _id?: string;
  id?: string;
  channelId: string;
  userId?: string;
  threadId?: string;
  messageId?: string;
  videoId?: string;
  title: string;
  content: string;
  blocks?: any[];
  wordCount: number;
  estimatedDurationMinutes: number;
  tags?: string[];
  source: 'ai_chat' | 'manual_import' | 'ai_beautified';
  formatType: 'teleprompter_beat' | 'standard_markdown' | 'raw_text';
  isFavorite: boolean;
  vectorSyncStatus: 'synced' | 'pending' | 'failed';
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptStats {
  totalScripts: number;
  totalSpokenHours: number;
  averageWordCount: number;
}

export interface ScriptListResponse {
  items: ScriptItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
