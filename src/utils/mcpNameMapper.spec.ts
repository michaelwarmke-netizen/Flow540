import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mapStarWarsNameToMcpName, mapActionItemOwners, STAR_WARS_TO_MCP_MAP } from './mcpNameMapper.ts';

describe('mcpNameMapper', () => {
  it('maps Star Wars characters to real team member names correctly', () => {
    assert.strictEqual(mapStarWarsNameToMcpName('Darth Vader'), 'Lucas Baker');
    assert.strictEqual(mapStarWarsNameToMcpName('darth vader'), 'Lucas Baker');
    assert.strictEqual(mapStarWarsNameToMcpName('Vader'), 'Lucas Baker');
    assert.strictEqual(mapStarWarsNameToMcpName('Grand Admiral Thrawn'), 'Audrey Stewart');
    assert.strictEqual(mapStarWarsNameToMcpName('General Grievous'), 'Mason Mitchell');
    assert.strictEqual(mapStarWarsNameToMcpName('Darth Maul'), 'Ethan Lopez');
    assert.strictEqual(mapStarWarsNameToMcpName('Darth Sidious'), 'Oliver Taylor');
    assert.strictEqual(mapStarWarsNameToMcpName('Grand Moff Tarkin'), 'Olivia Baker');
    assert.strictEqual(mapStarWarsNameToMcpName('Director Krennic'), 'Jackson Gray');
    assert.strictEqual(mapStarWarsNameToMcpName('Moff Jerjerrod'), 'Gavin Roberts');
    assert.strictEqual(mapStarWarsNameToMcpName('Admiral Piett'), 'James Scott');
    assert.strictEqual(mapStarWarsNameToMcpName('Boba Fett'), 'Dylan Williams');
  });

  it('preserves unmapped or non-matching names intact', () => {
    assert.strictEqual(mapStarWarsNameToMcpName('John Doe'), 'John Doe');
    assert.strictEqual(mapStarWarsNameToMcpName('Unassigned'), 'Unassigned');
    assert.strictEqual(mapStarWarsNameToMcpName(''), '');
  });

  it('maps action item owner arrays', () => {
    const items = [
      { title: 'Task 1', owner: 'Darth Vader', status: 'open' },
      { title: 'Task 2', owner: 'Grand Admiral Thrawn', status: 'in_progress' },
      { title: 'Task 3', owner: 'Unassigned', status: 'open' },
    ];

    const mapped = mapActionItemOwners(items);
    assert.deepStrictEqual(mapped, [
      { title: 'Task 1', owner: 'Lucas Baker', status: 'open' },
      { title: 'Task 2', owner: 'Audrey Stewart', status: 'in_progress' },
      { title: 'Task 3', owner: 'Unassigned', status: 'open' },
    ]);
  });
});
