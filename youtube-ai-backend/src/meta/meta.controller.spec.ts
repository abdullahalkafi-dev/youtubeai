import { BadRequestException } from '@nestjs/common';
import { MetaController } from './meta.controller';

function make() {
  const metaService = { disconnect: jest.fn().mockResolvedValue({ disconnected: true }) };
  const config = { get: () => 'http://localhost:3000' };
  return { controller: new MetaController(metaService as never, config as never), metaService };
}

describe('MetaController.disconnect', () => {
  it('without a loginId removes every login', async () => {
    const { controller, metaService } = make();
    await controller.disconnect('user-1');
    expect(metaService.disconnect).toHaveBeenCalledWith('user-1', undefined);
  });

  it('with a Meta account id removes only that login', async () => {
    const { controller, metaService } = make();
    await controller.disconnect('user-1', '29909738418627602');
    expect(metaService.disconnect).toHaveBeenCalledWith('user-1', '29909738418627602');
  });

  it('refuses anything that is not a plain id (no query objects reach the database filter)', () => {
    const { controller, metaService } = make();
    for (const bad of [{ $ne: 'x' }, ['a'], 'a b', '', 'x'.repeat(65), '{"$gt":""}'] as unknown as string[]) {
      expect(() => controller.disconnect('user-1', bad)).toThrow(BadRequestException);
    }
    expect(metaService.disconnect).not.toHaveBeenCalled();
  });
});
