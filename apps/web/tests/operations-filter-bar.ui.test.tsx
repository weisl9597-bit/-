import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OperationsFilterBar } from '../components/filters/operations-filter-bar';
import { createOperationsFilterController } from '../components/filters/use-operations-filters';

describe('operations filter bar', () => {
  it('renders the four shared labels and clears downstream selections', () => {
    let current = {
      source: 'DESIGNBAO' as const, regionId: 'region-1', cityId: 'city-1', merchantId: 'M1',
    };
    let search = '';
    const controller = createOperationsFilterController(
      () => current,
      (next) => { current = next as typeof current; },
      (params) => { search = params.toString(); },
    );
    controller.setRegion('region-2');
    expect(current).toEqual({ source: 'DESIGNBAO', regionId: 'region-2' });
    expect(search).toContain('source=DESIGNBAO');
    controller.setSource('XIAOHONGSHU');
    expect(current).toEqual({ source: 'XIAOHONGSHU' });
    expect(search).toBe('source=XIAOHONGSHU');

    const html = renderToStaticMarkup(<OperationsFilterBar
      controller={controller}
      options={{
        enabled: true,
        regions: [{ id: 'region-2', name: '华东大区' }],
        cities: [], merchants: [],
        rebuildStatus: { state: 'IDLE', total: 0, completed: 0, failed: 0, lastSuccessfulDate: null },
      }}
    />);
    expect(html).toContain('业务来源');
    expect(html).toContain('大区');
    expect(html).toContain('城市');
    expect(html).toContain('商家');
  });
});

