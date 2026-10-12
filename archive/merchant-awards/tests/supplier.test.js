import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyBid, classifySupplier, normalizeSupplierName } from '../backend/supplier.js'

test('supplier matching uses the awardee field and explicit aliases', () => {
  assert.equal(normalizeSupplierName('TRUSTERA SOLUTIONS, INC.'), 'TRUSTERA SOLUTIONS INC')
  assert.equal(classifySupplier('TRUSTERA SOLUTIONS INC.'), 'truster')
  assert.equal(classifySupplier('  trustera solutions, inc. '), 'truster')
  assert.equal(classifySupplier('EQUICOM, INC.'), 'other')
  assert.equal(classifySupplier(''), 'unverified')
  assert.equal(classifySupplier(null), 'unverified')
  assert.equal(classifySupplier('Procurement of Trustera software licenses'), 'other')
})

test('a bid can be Trustera, another supplier, mixed, or supplier unverified', () => {
  const published = (awards) => ({ outcome: 'published', awards })
  assert.equal(classifyBid(published([{ supplier: 'TRUSTERA SOLUTIONS INC.' }])), 'truster')
  assert.equal(classifyBid(published([
    { supplier: 'TRUSTERA SOLUTIONS INC.' },
    { supplier: 'INNOVE COMMUNICATIONS, INC.' },
  ])), 'mixed')
  assert.equal(classifyBid(published([{ supplier: 'EQUICOM, INC.' }])), 'other')
  assert.equal(classifyBid(published([{ supplier: '' }, { supplier: 'EQUICOM, INC.' }])), 'unverified')
  assert.equal(classifyBid(published([
    { supplier: 'TRUSTERA SOLUTIONS INC.' },
    { supplier: '' },
  ])), 'truster')
  assert.equal(classifyBid(published([{ title: 'Trustera software', supplier: null }])), 'unverified')
})

test('missing and failed checks are not treated as a loss', () => {
  assert.equal(classifyBid({ outcome: 'none', awards: [] }), 'none')
  assert.equal(classifyBid({ outcome: 'failed', awards: [{ supplier: 'EQUICOM, INC.' }] }), 'failed')
  assert.equal(classifyBid({ outcome: 'conflict', awards: [] }), 'conflict')
  assert.equal(classifyBid({ outcome: 'never', awards: [] }), 'never')
})
