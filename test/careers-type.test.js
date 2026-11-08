import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import test from 'node:test';

import { advanceCareersDmState, createCareersDmState, normalizeApplicationType, waitForSingleDmReply } from '../commands/careers.js';

test('normalizeApplicationType keeps EMS and TFR distinct', () => {
  assert.equal(normalizeApplicationType('tfr'), 'tfr');
  assert.equal(normalizeApplicationType('general'), 'tfr');
  assert.equal(normalizeApplicationType('ems'), 'ems');
  assert.equal(normalizeApplicationType('hr'), 'ems');
  assert.equal(normalizeApplicationType('highrank'), 'ems');
  assert.equal(normalizeApplicationType('high_ranking'), 'ems');
  assert.equal(normalizeApplicationType('unknown'), 'tfr');
});

test('waitForSingleDmReply resolves the first valid user message', async () => {
  const user = { id: '123' };
  const expected = { author: { id: '123', bot: false }, content: 'hello' };
  const channel = {
    awaitMessages: async ({ filter }) => {
      assert.equal(typeof filter, 'function');
      const message = filter(expected) ? expected : null;
      return new Collection([[expected.id ?? '1', message]]);
    },
  };

  const result = await waitForSingleDmReply(channel, user, 1000);
  assert.equal(result.content, 'hello');
});

test('advanceCareersDmState moves to the next question after a valid response', () => {
  const user = { id: '123' };
  const state = createCareersDmState(user, 'tfr');

  const next = advanceCareersDmState(state, 'I am active');

  assert.equal(next.done, false);
  assert.equal(state.answers.length, 1);
  assert.equal(state.index, 1);
  assert.equal(state.answers[0].answer, 'I am active');
  assert.equal(next.remaining, state.questions.length - 1);
});
