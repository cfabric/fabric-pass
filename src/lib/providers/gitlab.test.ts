import { expect, test } from 'vitest'
import type { ZodError } from 'zod'
import { toIdentity } from './gitlab.ts'

test('takes the numeric id as a string, the username, and the display name', () => {
  const identity = toIdentity({ id: 1234567, username: 'ada', name: 'Ada Lovelace' })
  expect(identity).toEqual({ providerId: '1234567', username: 'ada', name: 'Ada Lovelace' })
})

test('leaves name out entirely when the account has none set', () => {
  expect(toIdentity({ id: 1234567, username: 'ada', name: '' }).name).toBeUndefined()
  expect(toIdentity({ id: 1234567, username: 'ada', name: null }).name).toBeUndefined()
  expect(toIdentity({ id: 1234567, username: 'ada' }).name).toBeUndefined()
})

// `read_user` also exposes the account's private email — this asserts it
// never leaks into the stored identity (data minimization).
test('never carries an email, even though the profile has one', () => {
  const identity = toIdentity({ id: 1234567, username: 'ada', name: 'Ada', email: 'ada@example.com' })
  expect(identity).not.toHaveProperty('email')
})

test('rejects a profile with no username', () => {
  expect(() => toIdentity({ id: 1234567 })).toThrow(/username/)
})

test('rejects a profile with no id', () => {
  try {
    toIdentity({ username: 'ada' })
    expect.unreachable('a profile with no id must be rejected')
  } catch (error) {
    expect((error as ZodError).issues.map((issue) => issue.path)).toEqual([['id']])
  }
})

test('rejects a non-numeric id', () => {
  expect(() => toIdentity({ id: 'abc', username: 'ada' })).toThrow()
})
