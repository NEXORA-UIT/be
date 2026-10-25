import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCardListQuery } from '../../src/modules/cards/dto/card.schema.js';

describe('Board Card list query', () => {
  it('preserves defaults and normalizes supported filters', () => {
    assert.deepEqual(parseCardListQuery({}), { includeArchived: false });
    assert.deepEqual(
      parseCardListQuery({
        includeArchived: 'true',
        q: '  Release plan  ',
        assigneeId: ['61a74e90-5866-448f-8d04-f282f37836f1'],
        labelId: ['b282a786-6d14-4c63-a5db-70fa5a95dc6b'],
        statusGroup: 'IN_PROGRESS',
        isOverdue: 'false',
      }),
      {
        includeArchived: true,
        q: 'Release plan',
        assigneeId: ['61a74e90-5866-448f-8d04-f282f37836f1'],
        labelId: ['b282a786-6d14-4c63-a5db-70fa5a95dc6b'],
        statusGroup: 'IN_PROGRESS',
        isOverdue: false,
      },
    );
  });

  it('normalizes repeated assignee and label query values into de-duplicated ID arrays', () => {
    assert.deepEqual(
      parseCardListQuery({
        assigneeId: [
          '61a74e90-5866-448f-8d04-f282f37836f1',
          '61a74e90-5866-448f-8d04-f282f37836f1',
          'c383e8a3-df44-405f-93b8-618dca143a25',
        ],
        labelId: ['b282a786-6d14-4c63-a5db-70fa5a95dc6b', '77b4587e-46a2-4b69-a6e5-7f00f1cc6cc7'],
      }),
      {
        includeArchived: false,
        assigneeId: [
          '61a74e90-5866-448f-8d04-f282f37836f1',
          'c383e8a3-df44-405f-93b8-618dca143a25',
        ],
        labelId: ['b282a786-6d14-4c63-a5db-70fa5a95dc6b', '77b4587e-46a2-4b69-a6e5-7f00f1cc6cc7'],
      },
    );
  });

  it('rejects malformed filters and unknown query parameters', () => {
    for (const query of [
      { q: '   ' },
      { q: 'x'.repeat(101) },
      { assigneeId: 'not-a-uuid' },
      { assigneeId: ['61a74e90-5866-448f-8d04-f282f37836f1', 'invalid'] },
      { assigneeId: [] },
      { assigneeId: Array.from({ length: 101 }, () => '61a74e90-5866-448f-8d04-f282f37836f1') },
      { labelId: 'not-a-uuid' },
      { statusGroup: 'BLOCKED' },
      { isOverdue: 'yes' },
      { unrecognized: 'value' },
    ]) {
      assert.throws(() => parseCardListQuery(query), { code: 'VALIDATION_ERROR' });
    }
  });
});
