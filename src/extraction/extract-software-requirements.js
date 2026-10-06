import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractDocumentText } from './extract.js';
import { extractSoftwareRequirements } from './software-requirements.js';
import { log } from '../log.js';
import { projectRoot } from '../project-root.js';

export function requirementsPath(noticeId, outputDir = path.join(projectRoot, 'data', 'output')) {
  return path.join(outputDir, `${noticeId}.requirements.json`);
}

export async function loadExtractedTextSources(noticeId, outputDir = path.join(projectRoot, 'data', 'output')) {
  const extractedPath = path.join(outputDir, `${noticeId}.extracted.txt`);
  if (!existsSync(extractedPath)) return [];
  const body = await readFile(extractedPath, 'utf8');
  const chunks = body.split(/\n(?=Source:\s+)/);
  const sources = [];
  for (const chunk of chunks) {
    const match = chunk.match(/^Source:\s*(.+)\n([\s\S]*)$/);
    if (!match) continue;
    sources.push({ filename: match[1].trim(), text: match[2] || '' });
  }
  if (sources.length === 0 && body.trim()) {
    sources.push({ filename: `${noticeId}.extracted.txt`, text: body });
  }
  return sources;
}

export async function loadDocumentTextSources(documents = [], {
  documentsRoot = path.join(projectRoot, 'data', 'documents'),
  preferExtracted = true,
  noticeId,
  outputDir,
} = {}) {
  if (preferExtracted && noticeId) {
    const fromExtracted = await loadExtractedTextSources(noticeId, outputDir);
    if (fromExtracted.length > 0) return fromExtracted;
  }

  const sources = [];
  for (const document of documents) {
    const localPath = document.localPath
      || (noticeId && document.filename
        ? path.join(documentsRoot, String(noticeId), document.filename)
        : null);
    if (!localPath || !existsSync(localPath)) continue;
    try {
      const extracted = await extractDocumentText(localPath, {
        // Full-document mode: no classification early-stop.
        ocrMode: 'extraction',
      });
      if (extracted?.text) {
        sources.push({
          filename: document.filename || path.basename(localPath),
          text: extracted.text,
          usedOcr: extracted.usedOcr === true,
        });
      }
    } catch (error) {
      log('WARN', `Requirement extraction could not read ${document.filename || localPath}: ${error.message}`);
    }
  }
  return sources;
}

export async function saveSoftwareRequirements(noticeId, requirements, {
  outputDir = path.join(projectRoot, 'data', 'output'),
} = {}) {
  await mkdir(outputDir, { recursive: true });
  const filePath = requirementsPath(noticeId, outputDir);
  await writeFile(filePath, `${JSON.stringify(requirements, null, 2)}\n`);
  return filePath.split(path.sep).join('/');
}

export async function extractAndSaveSoftwareRequirements({
  notice,
  documents = [],
  noticeId = notice?.referenceNumber,
  outputDir = path.join(projectRoot, 'data', 'output'),
  documentsRoot = path.join(projectRoot, 'data', 'documents'),
  preferExtracted = true,
} = {}) {
  if (!noticeId) throw new Error('noticeId is required for requirement extraction');
  const sources = await loadDocumentTextSources(documents, {
    documentsRoot,
    preferExtracted,
    noticeId,
    outputDir,
  });
  const requirements = extractSoftwareRequirements({ notice, sources });
  const savedPath = await saveSoftwareRequirements(noticeId, requirements, { outputDir });
  log('INFO', `Saved procurement requirements ${savedPath} (${requirements.extractionStatus})`);
  return { requirements, savedPath, sourcesUsed: sources.map((part) => part.filename) };
}

export async function readSavedSoftwareRequirements(noticeId, {
  outputDir = path.join(projectRoot, 'data', 'output'),
} = {}) {
  const filePath = requirementsPath(noticeId, outputDir);
  if (!existsSync(filePath)) return null;
  return JSON.parse(await readFile(filePath, 'utf8'));
}
