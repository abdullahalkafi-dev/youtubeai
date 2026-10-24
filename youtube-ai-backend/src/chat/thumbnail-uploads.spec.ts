import { ChatService } from './chat.service';
import { matchUploadedPhoto, recentChatUploads } from './thumbnail-uploads';
import { nameVariants } from '../openai/subject-reference.service';

const img = (url: string) => ({ type: 'image', url });

describe('nameVariants', () => {
  it('lets "John Gotti Sr." find the photo stored as "John Gotti"', () => {
    expect(nameVariants('John Gotti Sr.')).toEqual(['John Gotti Sr.', 'John Gotti']);
    expect(nameVariants('Martin Luther King, Sr')).toEqual(['Martin Luther King, Sr', 'Martin Luther King']);
    expect(nameVariants('John Gotti Senior')).toEqual(['John Gotti Senior', 'John Gotti']);
  });

  it('never strips Jr. and leaves plain names alone', () => {
    expect(nameVariants('John Gotti Jr.')).toEqual(['John Gotti Jr.']);
    expect(nameVariants('Sean "Diddy" Combs')).toEqual(['Sean "Diddy" Combs']);
    expect(nameVariants('')).toEqual(['']);
  });
});

describe('photos the client sent in chat', () => {
  const messages: any[] = [
    {
      role: 'user',
      content: 'make me a thumbnail the first picture is John Gotti the second one is John Gotti Jr his son\n\n[Image uploaded: a.png]',
      metadata: { attachments: [img('https://m/jr.png')] },
    },
    { role: 'assistant', content: 'Please upload John Gotti Sr.' },
    {
      role: 'user',
      content: "that's the picture of John Gotti senior put it in concept one\n\n[Image uploaded: b.png]",
      metadata: { attachments: [img('https://m/sr.png')] },
    },
  ];

  it('lists the newest photo first with the client’s words', () => {
    const uploads = recentChatUploads(messages);
    expect(uploads.map((u) => u.url)).toEqual(['https://m/sr.png', 'https://m/jr.png']);
    expect(uploads[0].text).toContain('John Gotti senior');
  });

  it('skips the host’s own photo', () => {
    const own = [{ role: 'user', content: 'this is me, use it', metadata: { attachments: [img('https://m/me.png')] } }];
    expect(recentChatUploads(own as any)).toEqual([]);
  });

  it('gives the senior the senior photo and the junior the junior photo', () => {
    const uploads = recentChatUploads(messages);
    expect(matchUploadedPhoto('John Gotti Sr.', uploads)?.url).toBe('https://m/sr.png');
    expect(matchUploadedPhoto('John Gotti Jr.', uploads)?.url).toBe('https://m/jr.png');
  });

  it('never uses a photo for a person the client did not name', () => {
    const uploads = recentChatUploads(messages);
    expect(matchUploadedPhoto('Sean Combs', uploads)).toBeUndefined();
  });

  it('a plain "John Gotti" is the senior, so the junior’s photo is not used for him', () => {
    const onlyJr = recentChatUploads([messages[0]]);
    expect(matchUploadedPhoto('John Gotti', onlyJr)).toBeUndefined();
  });
});

describe('generation uses the client’s chat photo for a person with no verified photo', () => {
  function service(people: any[], messages: any[]) {
    const s: any = Object.create(ChatService.prototype);
    s.logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    s.threadModel = {
      findById: jest.fn().mockResolvedValue({ _id: 't', channelId: 'c', title: 'Gotti', messages }),
      updateOne: jest.fn(),
    };
    s.videoModel = { findById: jest.fn() };
    s.creatorPreferencesModel = { findOne: () => ({ select: () => ({ lean: async () => null }) }) };
    s.subjectReferenceService = { resolveSubjects: jest.fn().mockResolvedValue(people) };
    s.openaiService = {
      generateThumbnailImage: jest.fn().mockResolvedValue({
        imageUrl: 'https://img/final.png',
        cleanBackgroundUrl: 'https://img/clean.png',
        revisedPrompt: '',
      }),
      extractStoryContextFromThread: jest.fn().mockResolvedValue(''),
      reviewThumbnailText: jest.fn().mockResolvedValue({ ok: true, issues: [] }),
    };
    return s;
  }

  const people = () => [
    { name: 'John Gotti Jr.', role: 'Son', imageUrl: 'https://p/jr.jpg', photoStatus: 'verified' },
    { name: 'John Gotti Sr.', role: 'Father', photoStatus: 'missing' },
  ];
  const dto = { text: 'GOTTI JR. TOOK A PLEA', visual: 'John Gotti Sr. furious, John Gotti Jr. ashamed', colors: '' };

  it('generates with both faces instead of waiting', async () => {
    const msgs = [
      {
        role: 'user',
        content: "that's the picture of John Gotti senior",
        metadata: { attachments: [img('https://m/sr.png')] },
      },
    ];
    const s = service(people(), msgs);
    const result = await s.generateThumbnailImage('t', dto);
    expect(result.needsPhoto).toBeUndefined();
    expect(s.openaiService.generateThumbnailImage.mock.calls[0][0].referenceImageUrls).toEqual([
      'https://p/jr.jpg',
      'https://m/sr.png',
    ]);
  });

  it('still asks for the photo when the client sent none for that person', async () => {
    const s = service(people(), [{ role: 'user', content: 'make me a thumbnail' }]);
    const result = await s.generateThumbnailImage('t', dto);
    expect(result.needsPhoto).toEqual([{ name: 'John Gotti Sr.', role: 'Father' }]);
    expect(s.openaiService.generateThumbnailImage).not.toHaveBeenCalled();
  });
});
