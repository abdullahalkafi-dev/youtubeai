export interface ThumbnailEditDecision {
  userIntentSummary: string;
  category: 'overlay_only' | 'scene_generation' | 'hybrid';
  detectedMainSubject?: string;
  uploadedImageRole?: 'host' | 'main_character' | 'none';
  overlayActions: {
    host: 'remove' | 'keep' | 'change_image' | 'no_change';
    newHostImage?: string;
    logo: 'remove' | 'keep' | 'top-left' | 'top-right' | 'no_change';
    aspectRatio?: '16:9' | '9:16' | 'keep';
  };
  sceneActions: {
    mainSubject: 'keep_intact' | 'remove' | 'replace' | 'modify_appearance';
    mainSubjectInstruction?: string;
    headlineText: 'keep' | 'change' | 'remove';
    newHeadlineText?: string;
    visualModifications?: string;
  };
  compiledDiffusionPrompt: string;
}
