import assert from 'node:assert/strict'
import test from 'node:test'
import { importMerchantBatch, parseAwardNotice } from '../backend/merchant-import.js'

const AWARD = {
  awardNumber: '900101',
  lineItem: 'Sample software licenses',
  procurementMode: 'Small Value Procurement',
  classification: 'Goods',
  publishedDate: '19 Aug 2026',
  awardDate: '2026-08-12',
  status: 'published',
  awardCategory: 'Notice of Award',
  acceptance: 'pending for acceptance',
  contractAmount: '211423.62',
  approvedBudget: '₱215,000.00',
  noticeReference: '50850',
  sourceUrl: 'https://philgeps.gov.ph/BidAwards/viewAwardNotice/900101',
}

const INVITATION = {
  noticeReference: '900201',
  title: 'Sample invitation for support services',
  procurementMode: 'Small Value Procurement',
  classification: 'Goods',
  approvedBudget: 'PHP 1,000.00',
  publishedDate: '01-Jan-2026',
  closingDate: '15 Jan 2026',
  agency: 'Sample Agency',
  status: 'Open',
  sourceUrl: 'https://philgeps.gov.ph/Bids/viewInvitation/900201',
}

test('a merchant award import normalizes dates and amounts without changing their meaning', () => {
  const parsed = parseAwardNotice(AWARD)
  assert.equal(parsed.publishedDate, '2026-08-19')
  assert.equal(parsed.awardDate, '2026-08-12')
  assert.equal(parsed.contractAmount, 'PHP 211,423.62')
  assert.equal(parsed.approvedBudget, 'PHP 215,000.00')
  assert.equal(parsed.status, 'Published')
  assert.equal(parsed.acceptance, 'Pending for Acceptance')
  assert.equal(parsed.classification, 'Goods')
})

test('duplicate merchant rows collapse by award number and invitation reference', () => {
  const result = importMerchantBatch({
    awards: [AWARD, { ...AWARD, classification: 'Goods - General Support Services' }],
    invitations: [INVITATION, { ...INVITATION, agency: 'Another Agency' }],
  })
  assert.equal(result.awards.length, 1)
  assert.equal(result.invitations.length, 1)
  assert.equal(result.duplicates.length, 2)
  assert.equal(result.awards[0].classification, 'Goods')
  assert.equal(result.invitations[0].agency, 'Sample Agency')
  assert.equal(result.conflicts.length, 2)
  assert.equal(result.live, false)
})

test('an import keeps confirmed values and earlier verification history', () => {
  const existing = {
    awardNumber: '900101',
    lineItem: 'Sample software licenses',
    contractAmount: 'PHP 211,423.62',
    acceptance: 'Pending for Acceptance',
    awardDate: '05-Jun-2026',
    classification: null,
    verifiedAt: '2026-10-11T07:21:14.000Z',
    history: [{
      awardNumber: '900101',
      lineItem: 'Earlier title',
      acceptance: 'Pending for Acceptance',
      verifiedAt: '2026-10-01T00:00:00.000Z',
    }],
  }
  const result = importMerchantBatch({
    awards: [{
      ...AWARD,
      acceptance: 'Accepted',
      awardDate: '2026-06-05',
      contractAmount: 'PHP 1.00',
    }],
    existingAwards: [existing, {
      awardNumber: '900199',
      lineItem: 'Earlier confirmed award',
      acceptance: 'Accepted',
      contractAmount: 'PHP 19.00',
      history: [],
    }],
  })
  const award = result.awards.find((row) => row.awardNumber === '900101')
  assert.equal(result.awards.find((row) => row.awardNumber === '900199').lineItem, 'Earlier confirmed award')
  assert.equal(award.acceptance, 'Accepted')
  assert.equal(award.contractAmount, 'PHP 211,423.62')
  assert.equal(award.awardDate, '05-Jun-2026')
  assert.equal(award.classification, 'Goods')
  assert.equal(award.verifiedAt, '2026-10-11T07:21:14.000Z')
  assert.equal(award.history.length, 2)
  assert.equal(award.history[0].lineItem, 'Earlier title')
  assert.equal(award.history[1].acceptance, 'Pending for Acceptance')
  assert.equal(award.history[1].classification, null)
  assert.equal(result.conflicts.some((conflict) => conflict.field === 'acceptance'), false)
  assert.equal(result.conflicts.some((conflict) => conflict.field === 'contractAmount'), true)
})

test('a later read can move acceptance and award status while keeping the previous snapshot', () => {
  const existing = {
    awardNumber: '900101',
    lineItem: 'Sample software licenses',
    status: 'Published',
    acceptance: 'Pending for Acceptance',
    contractAmount: 'PHP 211,423.62',
    history: [],
  }
  const accepted = importMerchantBatch({
    awards: [{
      ...AWARD,
      acceptance: 'Accepted',
      status: 'NTP issued',
      verifiedAt: '2026-10-12T01:00:00.000Z',
    }],
    existingAwards: [existing],
  })
  const award = accepted.awards[0]
  assert.equal(award.acceptance, 'Accepted')
  assert.equal(award.status, 'NTP issued')
  assert.equal(award.contractAmount, 'PHP 211,423.62')
  assert.equal(award.verifiedAt, '2026-10-12T01:00:00.000Z')
  assert.equal(award.history.length, 1)
  assert.equal(award.history[0].acceptance, 'Pending for Acceptance')
  assert.equal(award.history[0].status, 'Published')

  const repeated = importMerchantBatch({
    awards: [{ ...AWARD, acceptance: 'accepted', status: 'ntp issued' }],
    existingAwards: [award],
  })
  assert.equal(repeated.awards[0].history.length, 1)
  assert.equal(repeated.changes.length, 0)

  const reversed = importMerchantBatch({
    awards: [{ ...AWARD, acceptance: 'Pending for Acceptance', status: 'Cancelled' }],
    existingAwards: [award],
  })
  assert.equal(reversed.awards[0].acceptance, 'Accepted')
  assert.equal(reversed.awards[0].status, 'Cancelled')
  assert.equal(reversed.awards[0].history.length, 2)
  assert.equal(reversed.awards[0].history[1].acceptance, 'Accepted')
  assert.equal(reversed.awards[0].history[1].status, 'NTP issued')
  assert.equal(reversed.conflicts.some((conflict) => conflict.field === 'acceptance'), true)
})

test('an invitation status change is stored and the previous status stays in history', () => {
  const existing = {
    noticeReference: '900201',
    title: 'Sample invitation for support services',
    status: 'Open',
    approvedBudget: 'PHP 1,000.00',
    history: [],
  }
  const result = importMerchantBatch({
    invitations: [{ ...INVITATION, status: 'Closed', title: 'Replacement title' }],
    existingInvitations: [existing],
  })
  const invitation = result.invitations[0]
  assert.equal(invitation.status, 'Closed')
  assert.equal(invitation.title, 'Sample invitation for support services')
  assert.equal(invitation.approvedBudget, 'PHP 1,000.00')
  assert.equal(invitation.history.length, 1)
  assert.equal(invitation.history[0].status, 'Open')
  assert.equal(result.conflicts.some((conflict) => conflict.field === 'title'), true)

  const casing = importMerchantBatch({
    invitations: [{ ...INVITATION, status: 'closed' }],
    existingInvitations: [invitation],
  })
  assert.equal(casing.invitations[0].status, 'Closed')
  assert.equal(casing.invitations[0].history.length, 1)
  assert.equal(casing.changes.length, 0)
})

test('malformed merchant rows are rejected and do not remove valid rows', () => {
  const result = importMerchantBatch({
    awards: [
      AWARD,
      { awardNumber: '900102' },
      { ...AWARD, awardNumber: '900103', contractAmount: 'PHP 10.5' },
      { ...AWARD, awardNumber: '900104', password: 'secret' },
      { ...AWARD, awardNumber: '900105', fixture: true },
      { ...AWARD, awardNumber: '900106', awardDate: '31 Feb 2026' },
    ],
    invitations: [
      { noticeReference: 'SAMPLE-1001', title: 'Sample', fixture: true },
      { noticeReference: '900202', approvedBudget: 'PHP 1.00' },
    ],
  })
  assert.equal(result.awards.length, 1)
  assert.equal(result.awards[0].awardNumber, '900101')
  assert.equal(result.invitations.length, 0)
  assert.equal(result.rejected.length, 7)
  assert.equal(result.rejected.some((row) => row.error === 'Line item is required.'), true)
  assert.equal(result.rejected.some((row) => row.error === 'Unrecognized amount.'), true)
  assert.equal(result.rejected.some((row) => row.error === 'Merchant credentials cannot be stored.'), true)
  assert.equal(result.rejected.some((row) => row.error === 'Fixture records cannot be imported as Merchant account data.'), true)
  assert.equal(result.rejected.some((row) => row.error === 'Unrecognized date.'), true)
  assert.equal(result.rejected.some((row) => row.error === 'Notice title is required.'), true)
})

test('a batch that is not a list fails before any record is accepted', () => {
  assert.throws(() => importMerchantBatch({ awards: null }), { code: 'INVALID' })
})
