jest.mock('dns/promises', () => ({
  ...jest.requireActual('dns/promises'),
  lookup: jest.fn(),
}));
jest.mock('https', () => ({
  ...jest.requireActual('https'),
  request: jest.fn(),
}));
import * as dns from 'dns/promises';
import * as https from 'https';
import { EventEmitter } from 'events';
import { retrieveSource } from './research';

describe('bounded source retrieval', () => {
  beforeEach(() => jest.resetAllMocks());
  it('uses checked DNS addresses for both single and all-address lookup modes', async () => {
    const addresses = [{ address: '8.8.8.8', family: 4 }];
    jest.mocked(dns.lookup).mockResolvedValue(addresses as any);
    jest.mocked(https.request).mockImplementation(((
      _url: any,
      options: any,
      callback: any,
    ) => {
      const all = jest.fn();
      options.lookup('example.test', { all: true }, all);
      expect(all).toHaveBeenCalledWith(null, addresses);
      const single = jest.fn();
      options.lookup('example.test', {}, single);
      expect(single).toHaveBeenCalledWith(null, '8.8.8.8', 4);
      const req: any = new EventEmitter();
      req.end = () => {
        const res: any = new EventEmitter();
        res.statusCode = 200;
        res.headers = { 'content-type': 'text/html' };
        callback(res);
        res.emit(
          'data',
          Buffer.from('<p>The family phone call lasted fifteen minutes.</p>'),
        );
        res.emit('end');
        req.emit('close');
      };
      req.destroy = (error: Error) => req.emit('error', error);
      return req;
    }) as any);
    const result = await retrieveSource('https://example.test/article');
    expect(result.text).toBe('The family phone call lasted fifteen minutes.');
    expect(result.error).toBeUndefined();
  });
  it('never opens a request to an internal address supplied by a source URL', async () => {
    jest
      .mocked(dns.lookup)
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as any);
    const request = jest.mocked(https.request);
    expect((await retrieveSource('https://private.test/')).error).toBe(
      'Source address is not public',
    );
    expect(request).not.toHaveBeenCalled();
  });
});
