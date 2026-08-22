import { describe, expect, it } from 'vitest';
import { buildOrganizationPaths } from '../src/jobs/prisma-import-repository';

describe('import organization hierarchy', () => {
  it('places every region and city under one national root', () => {
    expect(buildOrganizationPaths('华东', '苏州市')).toEqual({
      nationalPath: '/china',
      regionPath: '/china/%E5%8D%8E%E4%B8%9C',
      cityPath: '/china/%E5%8D%8E%E4%B8%9C/%E8%8B%8F%E5%B7%9E%E5%B8%82',
    });
  });
});
