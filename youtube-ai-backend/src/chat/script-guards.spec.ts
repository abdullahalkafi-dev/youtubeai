import { PerformanceContextService } from '../youtube/performance-context.service';
import {
  isPastedMaterial,
  isScriptSkill,
  mayReplaceSystemPrompt,
  shouldSkipPerformanceLookup,
} from './script-guards';

describe('script guards', () => {
  // The real shape of the failing request: a short ask followed by a long pasted script that
  // talks about "the video", "retention" and "why".
  const pastedScript =
    'rewrite this 7 to 8 minutes and keep the story moving. ' +
    'In this video, why does the audience keep watching? The retention drops when the street code wins.\n'.repeat(
      30,
    );

  it('the pasted script really does trip the performance detectors', () => {
    expect(
      PerformanceContextService.isVideoAutopsyQuery(pastedScript) ||
        PerformanceContextService.isPerformanceQuery(pastedScript),
    ).toBe(true);
  });

  it('never lets an analysis prompt replace a script or outline prompt', () => {
    expect(mayReplaceSystemPrompt('script')).toBe(false);
    expect(mayReplaceSystemPrompt('outline')).toBe(false);
    expect(mayReplaceSystemPrompt('package')).toBe(false);
  });

  it('still lets analysis-type skills use the analysis prompts', () => {
    expect(mayReplaceSystemPrompt('analysis')).toBe(true);
    expect(mayReplaceSystemPrompt('general')).toBe(true);
    expect(mayReplaceSystemPrompt(undefined)).toBe(true);
  });

  it('skips the performance lookup for a script skill carrying pasted material only', () => {
    expect(shouldSkipPerformanceLookup('script', pastedScript)).toBe(true);
    expect(shouldSkipPerformanceLookup('script', 'write a script about Big30')).toBe(false);
    expect(shouldSkipPerformanceLookup('general', pastedScript)).toBe(false);
    expect(shouldSkipPerformanceLookup('analysis', pastedScript)).toBe(false);
  });

  it('recognises script skills and pasted material', () => {
    expect(isScriptSkill('script')).toBe(true);
    expect(isScriptSkill('seo')).toBe(false);
    expect(isScriptSkill(undefined)).toBe(false);
    expect(isPastedMaterial('short')).toBe(false);
    expect(isPastedMaterial(('x'.repeat(60) + '\n').repeat(25))).toBe(true);
    // The client dictates long asks as one paragraph: that is a request, not pasted material.
    expect(isPastedMaterial('write me a story in bullets on Puff Daddy '.repeat(40))).toBe(false);
  });
});
