import assert from 'node:assert/strict';
import { compileQuery } from '../src/index.mjs';

export function assertThrowsCode(callback, code, messagePart) {
  assert.throws(callback, (error) => {
    assert.equal(error.code, code);
    if (messagePart !== undefined) assert.ok(error.message.includes(String(messagePart)), error.message);
    return true;
  });
}

export function pg(fragment, options) {
  return compileQuery(fragment, { ...options, dialect: 'postgres' });
}

export function my(fragment, options) {
  return compileQuery(fragment, { ...options, dialect: 'mysql' });
}

export function lite(fragment, options) {
  return compileQuery(fragment, { ...options, dialect: 'sqlite' });
}

export function textOf(fragment, options) {
  return pg(fragment, options).text;
}

export const sampleSchema = {
  users: {
    columns: ['id', 'email', 'name', 'created_at'],
    sortable: ['id', 'created_at']
  },
  posts: ['id', 'user_id', 'title', 'published_at']
};
