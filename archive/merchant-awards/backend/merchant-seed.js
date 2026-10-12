/** Fields read from My Award Notices on 11 October 2026. Detail fields were added later from the official award pages. */
export const MERCHANT_VERIFIED_AT = '2026-10-11T07:21:14.000Z'
export const MERCHANT_DETAIL_VERIFIED_AT = '2026-10-11T10:12:47.000Z'

const LIST = {
  status: 'Published',
  awardCategory: 'Notice of Award',
  acceptance: 'Pending for Acceptance',
  supplier: null,
  noticeReference: null,
  approvedBudget: null,
  contractAmount: null,
  awardDate: null,
  publishedDate: null,
  agency: null,
  procurementMode: null,
  sourceUrl: null,
  source: 'merchant-list',
  verifiedAt: MERCHANT_VERIFIED_AT,
}

function previousList(awardNumber, lineItem) {
  return {
    awardNumber,
    lineItem,
    ...LIST,
  }
}

function detail(record) {
  return {
    status: 'Published',
    awardCategory: 'Notice of Award',
    acceptance: 'Pending for Acceptance',
    supplier: 'TRUSTERA SOLUTIONS INC.',
    procurementMode: 'Small Value Procurement',
    source: 'merchant-detail',
    verifiedAt: MERCHANT_DETAIL_VERIFIED_AT,
    history: [previousList(record.awardNumber, record.lineItem)],
    ...record,
  }
}

export const MERCHANT_SEED = [
  detail({
    awardNumber: '22316',
    lineItem: 'SOFTWARE LICENSES AND SUBSCRIPTION SERVICES - HUMAN RESOURCE DEVELOPMENT OFFICE',
    noticeReference: '50850',
    approvedBudget: 'PHP 215,000.00',
    contractAmount: 'PHP 211,423.62',
    awardDate: '2026-08-12',
    publishedDate: '2026-08-19',
    agency: 'City of Pasig',
    sourceUrl: 'https://philgeps.gov.ph/BidAwards/viewAwardNotice/22316',
  }),
  detail({
    awardNumber: '22247',
    lineItem: 'Procurement of CHATGPT Plus and Grammarly for Artificial Intelligence Support Tools for Institutional Assessments, Recognitions, Rankings, and Audits',
    noticeReference: '29865',
    approvedBudget: 'PHP 32,000.00',
    contractAmount: 'PHP 31,998.87',
    awardDate: '2026-06-24',
    publishedDate: '2026-08-19',
    agency: 'Southern Leyte State University',
    sourceUrl: 'https://philgeps.gov.ph/BidAwards/viewAwardNotice/22247',
  }),
  detail({
    awardNumber: '22249',
    lineItem: 'Procurement of Office Equipment (Canva PRO)',
    noticeReference: '22622',
    approvedBudget: 'PHP 4,000.00',
    contractAmount: 'PHP 3,920.00',
    awardDate: '2026-06-17',
    publishedDate: '2026-08-19',
    agency: 'Southern Leyte State University',
    sourceUrl: 'https://philgeps.gov.ph/BidAwards/viewAwardNotice/22249',
  }),
  detail({
    awardNumber: '29475',
    lineItem: 'Procurement of CANVA Pro Subscription for the CWC National and Regional Offices',
    noticeReference: '33701',
    approvedBudget: 'PHP 244,371.29',
    contractAmount: 'PHP 242,161.92',
    awardDate: '2026-06-11',
    publishedDate: '2026-09-17',
    agency: 'Council for the Welfare of Children, DSWD',
    sourceUrl: 'https://philgeps.gov.ph/BidAwards/viewAwardNotice/29475',
  }),
  {
    awardNumber: '16776',
    lineItem: 'Procurement of Zoom Subscription for Artificial Intelligence Support Tools for Institutional Assessments, Recognitions, Rankings, and Audits',
    status: 'Published',
    awardCategory: 'Notice of Award',
    acceptance: 'Accepted',
    supplier: 'TRUSTERA SOLUTIONS INC.',
    noticeReference: '29850',
    approvedBudget: 'PHP 20,000.00',
    contractAmount: 'PHP 19,715.78',
    awardDate: '05-Jun-2026',
    publishedDate: '17-Jul-2026',
    agency: 'Southern Leyte State University',
    procurementMode: 'Small Value Procurement',
    sourceUrl: 'https://philgeps.gov.ph/BidAwards/viewAwardNotice/16776',
    source: 'merchant-detail',
    verifiedAt: '2026-10-11T10:24:55.000Z',
    history: [
      {
        awardNumber: '16776',
        lineItem: 'Procurement of Zoom Subscription for Artificial Intelligence Support Tools for Institutional Assessments, Recognitions, Rankings, and Audits',
        status: 'Published',
        awardCategory: 'Notice of Award',
        acceptance: 'Accepted',
        supplier: 'TRUSTERA SOLUTIONS INC.',
        noticeReference: '29850',
        approvedBudget: 'PHP 20,000.00',
        contractAmount: 'PHP 19,715.78',
        awardDate: '05-Jun-2026',
        publishedDate: '17-Jul-2026',
        agency: null,
        procurementMode: null,
        sourceUrl: null,
        source: 'merchant-detail',
        verifiedAt: MERCHANT_VERIFIED_AT,
      },
    ],
  },
]
