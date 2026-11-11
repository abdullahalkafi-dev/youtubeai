import { createMetaState, verifyMetaState } from './meta-state';

const SECRET = 'test-secret';
const USER = '64b7f0c2a1b2c3d4e5f60718';

describe('meta state', () => {
  it('round-trips the user id', () => {
    const state = createMetaState(USER, SECRET);
    expect(verifyMetaState(state, SECRET)).toBe(USER);
  });

  it('rejects a state signed with another secret', () => {
    expect(verifyMetaState(createMetaState(USER, SECRET), 'other-secret')).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const [, mac] = createMetaState(USER, SECRET).split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'attacker', n: 'x', e: Date.now() + 60000 })).toString('base64url');
    expect(verifyMetaState(`${forged}.${mac}`, SECRET)).toBeNull();
  });

  it('rejects an expired state', () => {
    const state = createMetaState(USER, SECRET, 1_000);
    expect(verifyMetaState(state, SECRET, 1_000 + 11 * 60 * 1000)).toBeNull();
    expect(verifyMetaState(state, SECRET, 1_000 + 5 * 60 * 1000)).toBe(USER);
  });

  it('rejects empty, malformed and over-long input', () => {
    expect(verifyMetaState(undefined, SECRET)).toBeNull();
    expect(verifyMetaState('', SECRET)).toBeNull();
    expect(verifyMetaState('nodot', SECRET)).toBeNull();
    expect(verifyMetaState('a.b.c', SECRET)).toBeNull();
    expect(verifyMetaState(createMetaState(USER, SECRET), '')).toBeNull();
  });
});
