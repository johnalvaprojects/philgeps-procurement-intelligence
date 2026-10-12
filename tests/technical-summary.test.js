import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildCaseReport } from '../frontend/src/reports/case-report.js';
import {
  buildTechnicalSummary,
  resolveDocumentLinks,
} from '../frontend/src/requirements/technical-summary.js';

async function readFixture(name) {
  const file = new URL(`./fixtures/technical-summary/${name}`, import.meta.url);
  return JSON.parse(await readFile(file, 'utf8'));
}

// Notice 94421's requirements file was deleted from data/output. Its 351 stored
// clauses, original document names, and title cannot be recovered. This checks
// the same behavior: every stored clause is kept, item fields are not repeated,
// deployment stays labeled Document 01, and clause text is not copied into the
// case report. The clause strings below are the checks already named by this
// test, not a restored procurement record.
test('stored clauses stay out of summary facts and the case report', async () => {
  const requirements = await readFixture('clause-report-boundary.requirements.json');
  const summary = buildTechnicalSummary(requirements);

  assert.equal(summary.clauseCount, requirements.technical.requiredFeatures.length);
  assert.equal(summary.clauses.length, requirements.technical.requiredFeatures.length);
  assert.equal(summary.clauses[0].value, requirements.technical.requiredFeatures[0].value);
  assert.equal(summary.clauses[0].source, requirements.technical.requiredFeatures[0].source);
  assert.equal(summary.facts.some((fact) => fact.label === 'Product / Software'), false);
  assert.equal(summary.facts.some((fact) => fact.label === 'Quantity'), false);
  assert.equal(summary.facts.some((fact) => fact.label === 'Unit'), false);
  assert.equal(summary.facts.some((fact) => fact.label === 'License type / edition'), false);
  assert.equal(summary.facts.some((fact) => fact.label === 'Subscription duration'), false);
  const deployment = summary.facts.find((fact) => fact.label === 'Deployment / installation');
  assert.equal(deployment.value, 'cloud-based');
  assert.equal(deployment.sourceLabel, 'Document 01');
  assert.equal(deployment.sourceLabel.includes('.pdf'), false);
  assert.equal(summary.documents.length, 2);
  assert.equal(
    summary.facts.some((fact) => /subcontract|dispute resolution|contract termination/i.test(fact.value)),
    false,
  );

  const report = buildCaseReport({
    notice: { title: 'Clause boundary' },
    documents: summary.documents.map((filename) => ({ filename })),
    extractedRequirements: requirements,
  });
  assert.equal(report.extractedClauseCount, summary.clauseCount);
  assert.equal(report.technicalFacts.length, summary.facts.length);
  assert.equal(JSON.stringify(report).includes('General Conditions of Contract'), false);
  assert.equal(JSON.stringify(report).includes('shall not subcontract'), false);
});

test('a short case keeps license and duration without promoting clause text', async () => {
  const requirements = await readFixture('92301.requirements.json');
  const summary = buildTechnicalSummary(requirements);
  assert.equal(summary.clauseCount, 1);
  assert.equal(summary.facts.find((fact) => fact.label === 'License type / edition').value, 'Subscription');
  assert.match(summary.facts.find((fact) => fact.label === 'Subscription duration').value, /1-year subscription/);
  assert.equal(summary.facts.some((fact) => fact.label.startsWith('Product')), false);
  assert.equal(summary.facts.some((fact) => fact.label === 'Quantity'), false);
  assert.equal(summary.facts.every((fact) => !String(fact.sourceLabel || '').includes('.pdf')), true);
  assert.equal(summary.facts.some((fact) => fact.value.includes('Genuine Software')), false);
  assert.equal(summary.clauses[0].value.includes('Genuine Software'), true);
});

test('missing fields stay absent and unavailable documents are not given links', () => {
  const summary = buildTechnicalSummary({
    items: [{ description: { value: 'Accounting software', source: 'missing.pdf', confidence: 'medium' } }],
    technical: {
      requiredFeatures: [
        { value: 'Instant payment confirmation and real-time ledger updates upon transaction completion', source: 'missing.pdf' },
        { value: 'The Supplier shall not subcontract the whole of the Works without consent.', source: 'missing.pdf' },
      ],
    },
    sourceDocuments: ['missing.pdf'],
  });

  assert.deepEqual(summary.facts.map((fact) => fact.label), []);
  assert.equal(summary.clauseCount, 2);
  assert.equal(summary.clauses[1].value.startsWith('The Supplier shall not subcontract'), true);
  assert.deepEqual(summary.documents, ['missing.pdf']);

  const links = resolveDocumentLinks(summary.documents, [{ filename: 'other.pdf', url: '/api/notices/1/documents/other.pdf' }], 'ready');
  assert.equal(links[0].status, 'unavailable');
  assert.equal(links[0].href, null);

  const unknown = resolveDocumentLinks(['a-very-long-original-filename-that-must-not-be-shortened.pdf'], [], 'error');
  assert.equal(unknown[0].name, 'a-very-long-original-filename-that-must-not-be-shortened.pdf');
  assert.equal(unknown[0].status, 'unknown');
  assert.equal(unknown[0].href, null);
});

// Notice 94419's requirements file was deleted. Its stored clauses are gone, so
// the old clauseCount > 0 check cannot be repeated. Item text here is only a
// stand-in to prove those fields are not added beside the deployment fact.
test('deployment remains the only summary fact when item fields are stored', async () => {
  const requirements = await readFixture('deployment-fact.requirements.json');
  const summary = buildTechnicalSummary(requirements);
  assert.deepEqual(summary.facts.map((fact) => fact.label), ['Deployment / installation']);
  assert.equal(summary.facts[0].value, 'cloud-based');
  assert.equal(summary.facts[0].sourceLabel.startsWith('Document'), true);
  assert.equal(summary.clauseCount, 0);
});

test('empty requirements produce an empty summary', () => {
  const summary = buildTechnicalSummary(null);
  assert.deepEqual(summary.facts, []);
  assert.equal(summary.clauseCount, 0);
  assert.deepEqual(summary.documents, []);
});
