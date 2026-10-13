import assert from 'node:assert/strict'
import test from 'node:test'
import { parseLegacyPageLimit } from '../frontend/src/scan-portal.js'

test('Old PhilGEPS page limit accepts only whole numbers from 1 to 5', () => {
  assert.equal(parseLegacyPageLimit(1).ok, true)
  assert.equal(parseLegacyPageLimit(5).pageLimit, 5)
  for (const value of [0, 6, 1.5, '2', undefined, null]) {
    assert.equal(parseLegacyPageLimit(value).ok, false, String(value))
  }
})
