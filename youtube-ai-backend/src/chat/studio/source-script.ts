import { ScriptArtifact, SpokenSection, reflowScript } from './contracts';

/** Parse formatting inputs without asking a model to rewrite any spoken words. */
export function parseSourceScript(
  input: string,
  fallbackTitle = 'Script',
): ScriptArtifact | null {
  let text = input.replace(/\r\n/g, '\n');
  const marked = text.match(
    /<!--\s*SCRIPT_START\s*-->([\s\S]*?)<!--\s*SCRIPT_END\s*-->/i,
  );
  if (marked) text = marked[1];
  else if (text.includes('[ACTIVE SCRIPT CONTEXT]'))
    text = text.split('[ACTIVE SCRIPT CONTEXT]')[1].split('[USER REQUEST]')[0];
  else if (text.includes('[ATTACHMENT CONTENT]'))
    text = text.split('[ATTACHMENT CONTENT]')[1];
  else {
    const pasted = text.match(
      /(?:\b(?:script|text|transcript)\s*:\s*|\n\s*```(?:text|markdown)?\s*\n)([\s\S]+)/i,
    );
    if (pasted) text = pasted[1].replace(/\n```\s*$/, '');
    else {
      const afterInstruction = text.match(
        /^[^\n]*(?:format|breath|teleprompter|line breaks)[^\n]*\n+([\s\S]+)/i,
      );
      if (afterInstruction) text = afterInstruction[1];
      else if (!/^\s*(?:>\s|#{1,3}\s|SCRIPT TITLE:)/m.test(text)) return null;
    }
  }
  const lines = text.trim().split('\n');
  const titleLine = lines.find((line) => /^\s*#?\s*SCRIPT TITLE:/i.test(line));
  const title =
    titleLine?.replace(/^\s*#?\s*SCRIPT TITLE:\s*/i, '').trim() ||
    fallbackTitle;
  const quoted = lines.some((line) => /^\s*>\s?/.test(line));
  const sections: SpokenSection[] = [];
  let section: SpokenSection = {
    title: 'Delivery',
    purpose: 'Preserve the supplied speech',
    blocks: [],
  };
  let block: string[] = [];
  let inJewel = false;
  const flush = (cue?: 'BEAT' | 'PAUSE') => {
    if (block.length) {
      section.blocks.push({ lines: block, ...(cue ? { cue } : {}) });
      block = [];
    } else if (cue && section.blocks.length)
      section.blocks[section.blocks.length - 1].cue = cue;
  };
  for (const original of lines) {
    const line = original.trim();
    if (/^#?\s*SCRIPT TITLE:/i.test(line) || /^<!--/.test(line)) continue;
    if (/^#{1,6}\s/.test(line)) {
      flush();
      const heading = line.replace(/^#+\s*/, '').replace(/\*\*/g, '');
      if (/^JEWELS?$/i.test(heading) && section.blocks.length) {
        inJewel = true;
        section.jewel = [];
        continue;
      }
      inJewel = false;
      if (section.blocks.length) sections.push(section);
      section = {
        title: heading,
        purpose: 'Preserve the supplied speech',
        blocks: [],
      };
    } else if (/^\[(BEAT|PAUSE)\]$/i.test(line)) {
      if (!inJewel) flush(line.slice(1, -1).toUpperCase() as 'BEAT' | 'PAUSE');
    } else if (!line) flush();
    else if (!quoted || /^>\s?/.test(line)) {
      const spoken = original.replace(/^\s*>\s?/, '').trim();
      if (inJewel) section.jewel!.push(spoken);
      else block.push(spoken);
    }
  }
  flush();
  if (section.blocks.length) sections.push(section);
  return sections.length ? reflowScript({ title, sections }) : null;
}
