jest.mock('../chat/studio/research', () => ({
  retrieveSource: jest.fn(),
}));
import { SubjectReferenceService, matchOverride } from './subject-reference.service';
import { retrieveSource } from '../chat/studio/research';
const sharp = require('sharp');

describe('real-person photo resolution', () => {
  let ai: any, model: any, service: SubjectReferenceService;
  let photo: Buffer;
  const fetchMock = jest.fn();
  beforeAll(async () => {
    photo = await sharp({
      create: { width: 400, height: 400, channels: 3, background: 'gray' },
    })
      .jpeg()
      .toBuffer();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    (global as any).fetch = fetchMock;
    // Wikipedia has no page; image downloads return a valid photo.
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('wikipedia.org')
        ? { ok: false }
        : {
            ok: true,
            arrayBuffer: async () =>
              photo.buffer.slice(photo.byteOffset, photo.byteOffset + photo.length),
          },
    );
    ai = {
      chatFast: jest.fn().mockResolvedValue(
        JSON.stringify({
          subjects: [
            { name: 'Unique', role: 'Commentator', searchQuery: 'Unique' },
            { name: 'Matthew Hightower', role: 'Defendant', searchQuery: 'Matthew Hightower' },
          ],
        }),
      ),
      chatWithSearch: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          candidates: [
            { imageUrl: 'https://news.test/a.jpg', pageUrl: 'https://news.test/story', source: 'News' },
          ],
        }),
      }),
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({ realPhoto: true, prominentFaces: 1, clearFace: true }),
      }),
    };
    model = {
      findOne: jest.fn().mockResolvedValue(null),
      findOneAndUpdate: jest.fn().mockResolvedValue({}),
      updateOne: jest.fn().mockReturnValue({ catch: () => undefined }),
    };
    service = new SubjectReferenceService(
      { get: () => undefined } as any,
      ai,
      { isAvailable: async () => false } as any,
      model,
    );
    // Keep test files off disk: persisting is not under test here.
    (service as any).downloadAndPersistImage = jest.fn().mockResolvedValue(null);
  });

  it('never treats the channel host as a story subject', async () => {
    expect(SubjectReferenceService.isHostName('Unique')).toBe(true);
    expect(SubjectReferenceService.isHostName('Unique Mecca Audio')).toBe(true);
    expect(SubjectReferenceService.isHostName('Matthew Hightower')).toBe(false);
    const subjects = await service.detectStorySubjects('Hightower case', 'Unique turns toward Hightower');
    expect(subjects.map((s) => s.name)).toEqual(['Matthew Hightower']);
  });

  it('uses a web photo only when its page names the person and the face check passes', async () => {
    (retrieveSource as jest.Mock).mockResolvedValue({ text: 'Matthew Hightower was sentenced...' });
    const found = await service.searchSubjectPublicImage('Matthew Hightower');
    expect(found?.imageUrl).toBe('https://news.test/a.jpg');
    expect(model.findOneAndUpdate.mock.calls[0][1]).toMatchObject({ verified: true, sourcePageUrl: 'https://news.test/story' });
  });

  it('rejects and never caches a photo whose page does not name the person', async () => {
    (retrieveSource as jest.Mock).mockResolvedValue({ text: 'An unrelated article about someone else' });
    expect(await service.searchSubjectPublicImage('Matthew Hightower')).toBeNull();
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects a candidate the face check does not accept', async () => {
    (retrieveSource as jest.Mock).mockResolvedValue({ text: 'Matthew Hightower' });
    ai.chat.mockResolvedValue({ content: JSON.stringify({ realPhoto: true, prominentFaces: 3, clearFace: true }) });
    expect(await service.searchSubjectPublicImage('Matthew Hightower')).toBeNull();
  });

  it('ignores an old unverified cache entry and searches again', async () => {
    model.findOne.mockResolvedValue({ imageUrl: 'https://old/wrong.jpg', source: 'web', verified: false });
    (retrieveSource as jest.Mock).mockResolvedValue({ text: '' });
    expect(await service.searchSubjectPublicImage('Matthew Hightower')).toBeNull();
    expect(ai.chatWithSearch).toHaveBeenCalled();
  });

  it('prefers a client upload and reports missing photos', async () => {
    (retrieveSource as jest.Mock).mockResolvedValue({ text: '' });
    const withUpload = await service.resolveSubjects({
      title: 'Hightower',
      overrides: [{ name: 'Hightower', url: '/api/assets/minio/references/h.png' }],
    });
    expect(withUpload).toEqual([
      expect.objectContaining({ name: 'Matthew Hightower', photoStatus: 'client_upload', imageUrl: '/api/assets/minio/references/h.png' }),
    ]);
    const without = await service.resolveSubjects({ title: 'Hightower' });
    expect(without[0].photoStatus).toBe('missing');
  });

  it('matches an upload by a distinctive shared name', () => {
    expect(matchOverride('Duane "Keefe D" Davis', [{ name: 'Keefe D Davis', url: 'u' }])?.url).toBe('u');
    expect(matchOverride('Matthew Hightower', [{ name: 'Latrina Ashburne', url: 'u' }])).toBeUndefined();
  });
});
