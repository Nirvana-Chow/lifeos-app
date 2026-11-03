import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderAgentOperations } from '../scripts/agent-skill-reference.ts';
import { agentOperations } from '../src/agent-api/capabilities.ts';

test('the checked-in LifeOS Agent Skill reference matches the operation registry', () => {
  const reference = readFileSync(
    new URL('../skills/lifeos-agent/references/operations.md', import.meta.url),
    'utf8',
  );

  assert.equal(reference, renderAgentOperations(), 'Run node scripts/agent-skill-reference.ts after changing the API registry.');
});

test('generating the reference surfaces new operations and changes to existing operations', () => {
  const example = {
    id: 'synthetic-operation',
    method: 'GET',
    path: '/v1/synthetic-example',
    scope: 'todo:read',
    description: 'A synthetic operation used only in this test.',
  } as const;
  const withExtra = renderAgentOperations([...agentOperations, example]);

  assert.match(withExtra, /synthetic-operation.*GET.*\/v1\/synthetic-example.*todo:read/u);
  assert.notEqual(withExtra, renderAgentOperations());
  assert.notEqual(withExtra, renderAgentOperations([
    ...agentOperations,
    { ...example, description: 'A revised description.' },
  ]));
});
