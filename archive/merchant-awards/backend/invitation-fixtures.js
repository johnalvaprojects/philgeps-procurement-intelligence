/** Development samples only. These rows are not Trustera account records. */
export const INVITATION_FIXTURES = [
  {
    fixture: true,
    noticeReference: 'SAMPLE-1001',
    title: 'Sample invitation for a software subscription',
    procurementMode: 'Small Value Procurement',
    classification: 'Goods',
    approvedBudget: 'PHP 0.00',
    publishedDate: '01-Jan-2026',
    closingDate: '15-Jan-2026',
    agency: 'Sample Agency',
    status: 'Sample',
    sourceUrl: null,
  },
  {
    fixture: true,
    noticeReference: 'SAMPLE-1002',
    title: 'Sample invitation for support services',
    procurementMode: 'Small Value Procurement',
    classification: 'Goods',
    approvedBudget: 'PHP 0.00',
    publishedDate: '02-Feb-2026',
    closingDate: '16-Feb-2026',
    agency: 'Sample Agency',
    status: 'Sample',
    sourceUrl: null,
  },
]

export function listInvitationFixtures() {
  return INVITATION_FIXTURES.map((record) => ({ ...record }))
}
