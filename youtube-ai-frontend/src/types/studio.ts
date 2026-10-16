export type StudioStatus = 'pending' | 'running' | 'ready' | 'failed' | 'unknown' | 'needs_attention' | 'cancelled'
export interface StudioReview { status: 'pass' | 'repair' | 'needs_attention'; issues: string[] }
export interface StudioSection { title: string; purpose: string; blocks: { lines: string[]; cue?: 'BEAT' | 'PAUSE' }[]; jewel?: string[] }
export interface StudioConcept { text: string; visual: string; emotion: string; colors: string; aspectRatio: '16:9' | '9:16' }
export interface StudioArtifact {
  _id: string; kind: string; key: string; status: StudioStatus; error?: string; outdated?: boolean
  version: number; sourceArtifactId?: string; review?: StudioReview
  history?: { url?: string; data?: StudioArtifact['data']; correction?: number; review: StudioReview }[]
  data: { variantIndex?: number; title?: string; content?: string; description?: string; tags?: string[]; rationale?: string; sections?: StudioSection[]; thumbnails?: StudioConcept[]; url?: string; cleanBackgroundUrl?: string; concept?: StudioConcept; notes?: string[]; timing?: { seconds: number; words: number } }
}
export interface StudioRun { notes?: string[]; research?: { facts?: { claim: string; status: 'verified' | 'disputed' | 'unverified'; evidence: { url: string; quote: string }[] }[]; limitations?: string[]; web?: { sources?: { title: string; url: string; snippet?: string }[]; limitations?: string[] } }; id: string; _id?: string; status: string; stage: string; error?: string; artifacts: StudioArtifact[] }
export interface CreativePreferences {
  revision: number; enabled: boolean; wordsPerMinute: number; duration: { min: number; max: number }
  instructions: string[]; approvedExamples: string[]; visualReferences: string[]; excludeHost: boolean; excludeLogo: boolean
  visualReferenceAssets: { url: string; role: 'style' | 'counterexample'; note?: string }[]
  identityReferences: { name: string; url: string }[]
}
