import assert from 'node:assert/strict'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import express from 'express'
import awardRoutes from '../server/award-routes.js'
import { INVITATION_FIXTURES } from '../backend/invitation-fixtures.js'
import { loginStaff, provisionStaff, staffHeaders, useAuthRoutes } from '../../../tests/http-auth.js'

async function startServer() {
  const app = express()
  app.use(express.json())
  const account = await provisionStaff(app)
  const merchantAwardsDir = await mkdtemp(path.join(tmpdir(), 'philgeps-merchant-'))
  const awardsDir = await mkdtemp(path.join(tmpdir(), 'philgeps-public-awards-'))
  app.set('merchantAwardsDir', merchantAwardsDir)
  app.set('awardsDir', awardsDir)
  app.set('guestFullAccess', false)
  useAuthRoutes(app)
  app.use('/api/awards', awardRoutes)
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  server.auth = await loginStaff(server.address().port, account)
  const guest = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/guest`, { method: 'POST' })
  server.guestCookie = (guest.headers.get('set-cookie') || '').split(';')[0]
  server.merchantAwardsDir = merchantAwardsDir
  server.awardsDir = awardsDir
  return server
}

test('staff can read verified Trustera awards and guests cannot', async () => {
  const server = await startServer()
  try {
    const port = server.address().port
    const anonymous = await fetch(`http://127.0.0.1:${port}/api/awards/merchant`)
    assert.equal(anonymous.status, 401)
    const guest = await fetch(`http://127.0.0.1:${port}/api/awards/merchant`, {
      headers: { cookie: server.guestCookie },
    })
    assert.equal(guest.status, 403)

    const staff = await fetch(`http://127.0.0.1:${port}/api/awards/merchant`, {
      headers: staffHeaders(server.auth),
    })
    const body = await staff.json()
    assert.equal(staff.status, 200)
    assert.equal(body.records.length, 5)
    assert.equal(body.summary.awards, 5)
    assert.equal(body.summary.pending, 4)
    assert.equal(body.summary.accepted, 1)
    assert.equal(body.summary.contractValue, 'PHP 509,220.19')
    const pending = body.records.find((record) => record.awardNumber === '22316')
    assert.equal(pending.acceptance, 'Pending for Acceptance')
    assert.equal(pending.supplier, 'TRUSTERA SOLUTIONS INC.')
    assert.equal(pending.noticeReference, '50850')
    assert.equal(pending.approvedBudget, 'PHP 215,000.00')
    assert.equal(pending.contractAmount, 'PHP 211,423.62')
    assert.equal(pending.awardDate, '2026-08-12')
    assert.equal(pending.publishedDate, '2026-08-19')
    assert.equal(pending.agency, 'City of Pasig')
    assert.equal(pending.procurementMode, 'Small Value Procurement')
    assert.equal(pending.sourceUrl, 'https://philgeps.gov.ph/BidAwards/viewAwardNotice/22316')
    assert.equal(pending.history.length, 1)
    assert.equal(pending.history[0].contractAmount, null)
    assert.equal(pending.history[0].acceptance, 'Pending for Acceptance')
    const grammarly = body.records.find((record) => record.awardNumber === '22247')
    assert.equal(grammarly.contractAmount, 'PHP 31,998.87')
    assert.equal(grammarly.noticeReference, '29865')
    const canva = body.records.find((record) => record.awardNumber === '22249')
    assert.equal(canva.contractAmount, 'PHP 3,920.00')
    assert.equal(canva.noticeReference, '22622')
    const cwc = body.records.find((record) => record.awardNumber === '29475')
    assert.equal(cwc.contractAmount, 'PHP 242,161.92')
    assert.equal(cwc.agency, 'Council for the Welfare of Children, DSWD')
    assert.equal(cwc.publishedDate, '2026-09-17')
    const zoom = body.records.find((record) => record.awardNumber === '16776')
    assert.equal(zoom.supplier, 'TRUSTERA SOLUTIONS INC.')
    assert.equal(zoom.noticeReference, '29850')
    assert.equal(zoom.approvedBudget, 'PHP 20,000.00')
    assert.equal(zoom.contractAmount, 'PHP 19,715.78')
    assert.equal(zoom.acceptance, 'Accepted')
    assert.equal(zoom.awardDate, '05-Jun-2026')
    assert.equal(zoom.publishedDate, '17-Jul-2026')
    assert.equal(zoom.agency, 'Southern Leyte State University')
    assert.equal(zoom.procurementMode, 'Small Value Procurement')
    assert.equal(zoom.sourceUrl, 'https://philgeps.gov.ph/BidAwards/viewAwardNotice/16776')
    assert.equal(zoom.history.length, 1)
    assert.equal(zoom.history[0].acceptance, 'Accepted')
    assert.equal(zoom.history[0].contractAmount, 'PHP 19,715.78')
    assert.equal(zoom.history[0].agency, null)
    assert.equal(zoom.history[0].sourceUrl, null)
    assert.equal(body.connection.status, 'not-connected')
    assert.equal(body.connection.live, false)
    assert.equal(body.connection.label, 'PhilGEPS Merchant — Not connected')
    assert.equal(body.provenance, 'manual-verification')
    assert.equal(body.provenanceLabel, 'Manually verified — Not live synchronized.')
    assert.equal(pending.classification, null)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('Merchant award updates stay disabled and do not change preserved records', async () => {
  const server = await startServer()
  try {
    const port = server.address().port
    const anonymous = await fetch(`http://127.0.0.1:${port}/api/awards/merchant/22316`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acceptance: 'Accepted' }),
    })
    assert.equal(anonymous.status, 401)

    const guest = await fetch(`http://127.0.0.1:${port}/api/awards/merchant/22316`, {
      method: 'POST',
      headers: { cookie: server.guestCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ acceptance: 'Accepted' }),
    })
    assert.equal(guest.status, 403)

    const missingToken = await fetch(`http://127.0.0.1:${port}/api/awards/merchant/22316`, {
      method: 'POST',
      headers: { cookie: server.auth.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ acceptance: 'Accepted' }),
    })
    assert.equal(missingToken.status, 403)

    const updated = await fetch(`http://127.0.0.1:${port}/api/awards/merchant/22316`, {
      method: 'POST',
      headers: staffHeaders(server.auth, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ acceptance: 'Accepted' }),
    })
    const denied = await updated.json()
    assert.equal(updated.status, 403)
    assert.equal(denied.error, 'Merchant award updates are disabled.')

    const files = await readdir(server.merchantAwardsDir)
    assert.equal(files.filter((file) => file.endsWith('.json')).length, 0)
    const publicFiles = await readdir(server.awardsDir)
    assert.equal(publicFiles.length, 0)

    const list = await fetch(`http://127.0.0.1:${port}/api/awards/merchant`, {
      headers: staffHeaders(server.auth),
    })
    const body = await list.json()
    const pending = body.records.find((record) => record.awardNumber === '22316')
    assert.equal(body.records.length, 5)
    assert.equal(pending.acceptance, 'Pending for Acceptance')
    assert.equal(pending.contractAmount, 'PHP 211,423.62')
    assert.equal(pending.history.length, 1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('invitation fixtures are staff-only samples and are not Merchant awards', async () => {
  const server = await startServer()
  try {
    const port = server.address().port
    const anonymous = await fetch(`http://127.0.0.1:${port}/api/awards/invitations`)
    assert.equal(anonymous.status, 401)
    const guest = await fetch(`http://127.0.0.1:${port}/api/awards/invitations`, {
      headers: { cookie: server.guestCookie },
    })
    assert.equal(guest.status, 403)

    const staff = await fetch(`http://127.0.0.1:${port}/api/awards/invitations`, {
      headers: staffHeaders(server.auth),
    })
    const body = await staff.json()
    assert.equal(staff.status, 200)
    assert.equal(body.connection.live, false)
    assert.equal(body.connection.label, 'PhilGEPS Merchant — Not connected')
    assert.equal(body.provenance, 'not-retrieved')
    assert.equal(body.records.length, 0)
    assert.equal(JSON.stringify(body).includes('SAMPLE-1001'), false)
    assert.equal(INVITATION_FIXTURES.length, 2)
    assert.equal(INVITATION_FIXTURES.every((record) => String(record.noticeReference).startsWith('SAMPLE-')), true)

    const awards = await fetch(`http://127.0.0.1:${port}/api/awards/merchant`, {
      headers: staffHeaders(server.auth),
    })
    const awardBody = await awards.json()
    assert.equal(awardBody.records.some((record) => String(record.awardNumber).startsWith('SAMPLE-')), false)
    const overview = await fetch(`http://127.0.0.1:${port}/api/awards`, {
      headers: { cookie: server.guestCookie },
    })
    assert.equal(overview.status, 200)
    const publicBody = await overview.json()
    assert.equal(JSON.stringify(publicBody).includes('SAMPLE-1001'), false)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
