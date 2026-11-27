import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  CODE,
  SqlCageError,
  compileQuery,
  isValidIdentifier,
  quoteIdentifier,
  sql,
} from '../src/index.mjs';

const propertyOptions = { seed: 20261127, numRuns: 100 };
const identifier = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,24}$/)
  .filter((name) => !['__proto__', 'constructor', 'prototype'].includes(name.toLowerCase()));

test('generated valid identifiers are accepted and quoted by dialect', () => {
  fc.assert(
    fc.property(identifier, (name) => {
      assert.equal(isValidIdentifier(name), true);
      assert.equal(quoteIdentifier(name, 'postgres'), `"${name}"`);
      assert.equal(quoteIdentifier(name, 'mysql'), `\`${name}\``);
    }),
    propertyOptions,
  );
});

test('generated hostile values are bound as parameters rather than concatenated', () => {
  const hostileValue = fc.string({ maxLength: 80 }).map((suffix) => `${suffix}' OR '1'='1`);
  fc.assert(
    fc.property(hostileValue, (value) => {
      const compiled = compileQuery(sql`SELECT * FROM users WHERE name = ${value}`, { dialect: 'postgres' });
      assert.equal(compiled.text, 'SELECT * FROM users WHERE name = $1');
      assert.deepEqual(compiled.values, [value]);
    }),
    propertyOptions,
  );
});

test('generated invalid identifier shapes are rejected', () => {
  const invalidIdentifier = fc.oneof(
    fc.constant('__proto__'),
    fc.constant('constructor'),
    fc.stringMatching(/^[0-9][A-Za-z0-9_]{0,12}$/),
    fc.stringMatching(/^[A-Za-z][A-Za-z0-9_]{0,8}[- $.][A-Za-z0-9_]{0,8}$/),
  );
  fc.assert(
    fc.property(invalidIdentifier, (name) => {
      assert.equal(isValidIdentifier(name), false);
      assert.throws(
        () => quoteIdentifier(name, 'postgres'),
        (error) => error instanceof SqlCageError && error.code === CODE.INVALID_IDENTIFIER,
      );
    }),
    propertyOptions,
  );
});

test('generated undefined and non-finite parameters fail closed', () => {
  const badNumber = fc.constantFrom(Number.NaN, Infinity, -Infinity);
  fc.assert(
    fc.property(badNumber, fc.boolean(), (number, useUndefined) => {
      const value = useUndefined ? undefined : number;
      assert.throws(
        () => compileQuery(sql`SELECT ${value}`, { dialect: 'sqlite' }),
        (error) => error instanceof SqlCageError && error.code === CODE.INVALID_PARAMETER,
      );
    }),
    propertyOptions,
  );
});
