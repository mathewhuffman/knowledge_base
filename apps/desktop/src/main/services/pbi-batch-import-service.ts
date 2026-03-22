import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  PBIBatchScopeMode,
  PBIBatchScopePayload,
  type PBIBatchRecord,
  type PBIBatchImportRequest,
  type PBIBatchImportSummary,
  PBIImportFormat,
  PBIValidationStatus,
  type PBIFieldMapping,
  type PBIRecord
} from '@kb-vault/shared-types';
import { WorkspaceRepository } from './workspace-repository';
import { logger } from './logger';

type ParsedRow = Record<string, string>;

const HTML_TABLE_RE = /<table[\s\S]*?<\/table>/gi;
const CSV_HEADER_ALIAS_BUCKETS: Array<{ key: keyof PBIFieldMapping; keys: string[] }> = [
  { key: 'externalId', keys: ['id', 'work item id', 'item id', 'external id', 'workitem id', 'pbi id', 'work item', 'workitem'] },
  { key: 'title', keys: ['title', 'summary', 'name', 'work item title', 'short description'] },
  { key: 'description', keys: ['description', 'details', 'raw description', 'full description', 'body', 'text'] },
  { key: 'acceptanceCriteria', keys: ['acceptance criteria', 'acceptance', 'criteria', 'acceptance criteria text'] },
  { key: 'type', keys: ['type', 'work item type', 'item type', 'category'] },
  { key: 'priority', keys: ['priority', 'severity', 'impact'] },
  { key: 'parentExternalId', keys: ['parent id', 'parent', 'parent work item', 'parent external id', 'parentitemid'] }
];

const IGNORE_KEYWORDS = [
  'build',
  'build verification',
  'ci',
  'pipeline',
  'release',
  'upgrade',
  'test',
  'qa',
  'spike',
  'devops'
];

const TECHNICAL_TYPES = new Set(['task', 'chore', 'bug', 'investigation', 'spike']);

const PRIORITY_ORDER: Record<string, 'low' | 'medium' | 'high' | 'urgent'> = {
  low: 'low',
  l: 'low',
  medium: 'medium',
  m: 'medium',
  high: 'high',
  h: 'high',
  urgent: 'urgent',
  critical: 'urgent',
  u: 'urgent'
};

export class PBIBatchImportService {
  constructor(private readonly workspaceRepository: WorkspaceRepository) {}

  async importBatch(input: PBIBatchImportRequest): Promise<PBIBatchImportSummary> {
    const workspaceId = input.workspaceId;
    const sourceFormat = this.resolveSourceFormat(input);
    const workspace = await this.workspaceRepository.getWorkspace(workspaceId);

    logger.info('pbi.import.start', {
      workspaceId,
      sourceFileName: input.sourceFileName,
      sourceFormat
    });

    const rawSource = await this.loadRawSource(input.sourcePath, input.sourceContent, input.sourceFileName);
    const preservedPath = await this.persistRawSource(workspace.path, workspaceId, rawSource, input.sourceFileName, sourceFormat);
    const records = this.parseRows(rawSource, sourceFormat, this.resolveMapping(input.fieldMapping));

    const normalized = this.classifyRows(records);
    const candidateRows = normalized.filter((row) => row.validationStatus === PBIValidationStatus.CANDIDATE);
    const malformedRows = normalized.filter((row) => row.validationStatus === PBIValidationStatus.MALFORMED);
    const duplicateRows = normalized.filter((row) => row.validationStatus === PBIValidationStatus.DUPLICATE);
    const ignoredRows = normalized.filter((row) => row.validationStatus === PBIValidationStatus.IGNORED);

    const batchName = input.batchName?.trim() || this.defaultBatchName(input.sourceFileName);
    const counts = {
      candidateRowCount: candidateRows.length,
      malformedRowCount: malformedRows.length,
      duplicateRowCount: duplicateRows.length,
      ignoredRowCount: ignoredRows.length,
      scopedRowCount: candidateRows.length
    };
    const scopeMode = input.scope?.mode ?? PBIBatchScopeMode.ALL;

      const duplicateBatch = await this.workspaceRepository.findDuplicatePBIBatch(
        workspaceId,
        input.sourceFileName,
        records.length,
        {
          candidateRowCount: candidateRows.length,
          malformedRowCount: malformedRows.length,
          duplicateRowCount: duplicateRows.length,
          ignoredRowCount: ignoredRows.length
        }
      );
    if (duplicateBatch) {
      const rows = await this.workspaceRepository.getPBIRecords(workspaceId, duplicateBatch.id);
      const existingCandidateRows = rows.filter((row) => row.validationStatus === PBIValidationStatus.CANDIDATE);
      const existingIgnoredRows = rows.filter((row) => row.validationStatus === PBIValidationStatus.IGNORED);
      const existingMalformedRows = rows.filter((row) => row.validationStatus === PBIValidationStatus.MALFORMED);
      const existingDuplicateRows = rows.filter((row) => row.validationStatus === PBIValidationStatus.DUPLICATE);
      return {
        batch: duplicateBatch,
        rows,
        summary: {
          totalRows: rows.length,
          candidateRowCount: existingCandidateRows.length,
          malformedRowCount: existingMalformedRows.length,
          duplicateRowCount: existingDuplicateRows.length,
          ignoredRowCount: existingIgnoredRows.length,
          scopedRowCount: duplicateBatch.scopedRowCount
        },
        invalidRows: [...existingMalformedRows, ...existingIgnoredRows],
        duplicateRows: existingDuplicateRows,
        ignoredRows: existingIgnoredRows
      };
    }

    const createdBatch = await this.workspaceRepository.createPBIBatch(
      workspaceId,
      batchName,
      input.sourceFileName,
      preservedPath,
      sourceFormat,
      normalized.length,
      counts,
      scopeMode
    );

    await this.workspaceRepository.insertPBIRecords(workspaceId, createdBatch.id, normalized);
    await this.workspaceRepository.linkPBIRecordParents(workspaceId, createdBatch.id);
    const scopeResult = await this.workspaceRepository.setPBIBatchScope(
      workspaceId,
      createdBatch.id,
      scopeMode,
      input.scope?.selectedRows ?? [],
      input.scope?.selectedExternalIds ?? []
    );
    const batch = await this.workspaceRepository.getPBIBatch(workspaceId, createdBatch.id);
    logger.info('pbi.import.completed', {
      workspaceId,
      batchId: batch.id,
      sourceRows: normalized.length,
      candidates: candidateRows.length,
      scoped: scopeResult.scopedRowCount
    });

    return {
      batch,
      rows: normalized,
      summary: {
        totalRows: normalized.length,
        candidateRowCount: counts.candidateRowCount,
        malformedRowCount: counts.malformedRowCount,
        duplicateRowCount: counts.duplicateRowCount,
        ignoredRowCount: counts.ignoredRowCount,
        scopedRowCount: scopeResult.scopedRowCount
      },
      invalidRows: [...malformedRows, ...ignoredRows],
      duplicateRows,
      ignoredRows
    };
  }

  async getBatchPreflight(workspaceId: string, batchId: string): Promise<{
    batch: PBIBatchRecord;
    candidateRows: PBIRecord[];
    invalidRows: PBIRecord[];
    duplicateRows: PBIRecord[];
    ignoredRows: PBIRecord[];
    scopePayload: PBIBatchScopePayload;
    candidateTitles: string[];
  }> {
    const batch = await this.workspaceRepository.getPBIBatch(workspaceId, batchId);
    const allRows = await this.workspaceRepository.getPBIRecords(workspaceId, batchId);
    const candidateRows = allRows.filter((row) => row.validationStatus === PBIValidationStatus.CANDIDATE);
    const invalidRows = allRows.filter((row) => row.validationStatus === PBIValidationStatus.MALFORMED);
    const duplicateRows = allRows.filter((row) => row.validationStatus === PBIValidationStatus.DUPLICATE);
    const ignoredRows = allRows.filter((row) => row.validationStatus === PBIValidationStatus.IGNORED);

    const scopedRows = candidateRows
      .filter((row) => String(row.state ?? 'candidate') === 'candidate')
      .map((row) => row.sourceRowNumber)
      .filter((value): value is number => value !== undefined);

    const scopePayload: PBIBatchScopePayload = {
      batchId,
      workspaceId,
      mode: (batch.scopeMode ?? PBIBatchScopeMode.ALL) as PBIBatchScopeMode,
      scopedRowNumbers: scopedRows,
      scopedCount: batch.scopedRowCount,
      updatedAtUtc: batch.importedAtUtc
    };

    const candidateTitles = candidateRows.slice(0, 8).map((row) => row.title ?? '').filter(Boolean);
    return { batch, candidateRows, invalidRows, duplicateRows, ignoredRows, scopePayload, candidateTitles };
  }

  private resolveSourceFormat(input: PBIBatchImportRequest): PBIImportFormat {
    if (input.sourceFormat) {
      return input.sourceFormat;
    }
    const extension = path.extname(input.sourceFileName).toLowerCase().replace('.', '');
    if (extension === 'html' || extension === 'htm') {
      return PBIImportFormat.HTML;
    }
    return PBIImportFormat.CSV;
  }

  private defaultBatchName(sourceFileName: string): string {
    const normalized = path.basename(sourceFileName || '').trim();
    if (!normalized) {
      return `batch-${Date.now()}`;
    }
    return normalized.replace(/\.[^.]+$/, '') || `batch-${Date.now()}`;
  }

  private async loadRawSource(sourcePath?: string, sourceContent?: string, fileName = 'upload'): Promise<string> {
    if (sourceContent && sourceContent.trim()) {
      return sourceContent;
    }
    if (!sourcePath) {
      throw new Error('pbi.import requires sourcePath or sourceContent');
    }
    try {
      return await fs.readFile(sourcePath, 'utf8');
    } catch {
      throw new Error(`Unable to read source file ${fileName}`);
    }
  }

  private async persistRawSource(
    workspacePath: string,
    workspaceId: string,
    sourceContent: string,
    sourceFileName: string,
    sourceFormat: PBIImportFormat
  ): Promise<string> {
    const batchFolder = randomUUID();
    const importDir = path.join(workspacePath, 'imports', batchFolder);
    await fs.mkdir(importDir, { recursive: true });
    const safeBaseName = this.sanitizeFilename(sourceFileName || `batch-${Date.now()}`);
    const ext = sourceFormat === PBIImportFormat.CSV ? '.csv' : '.html';
    const destination = path.join(importDir, `${safeBaseName}${ext}`);
    await fs.writeFile(destination, sourceContent, 'utf8');

    logger.info('pbi.import.persisted', {
      workspaceId,
      sourceFile: sourceFileName,
      persistedTo: destination
    });
    return path.relative(workspacePath, destination);
  }

  private resolveMapping(inputMapping?: Partial<PBIFieldMapping>): PBIFieldMapping {
    const mapping: PBIFieldMapping = {
      externalId: '',
      title: '',
      description: '',
      acceptanceCriteria: '',
      priority: '',
      type: '',
      parentExternalId: ''
    };

    if (!inputMapping) {
      return mapping;
    }
    Object.entries(mapping).forEach(([key]) => {
      const provided = inputMapping[key as keyof PBIFieldMapping];
      if (provided) {
        mapping[key as keyof PBIFieldMapping] = provided;
      }
    });
    return mapping;
  }

  private parseRows(
    sourceContent: string,
    format: PBIImportFormat,
    mapping: PBIFieldMapping
  ): Array<PBIRecord> {
    const rows = format === PBIImportFormat.HTML ? this.parseHtmlRows(sourceContent) : this.parseCsvRows(sourceContent);
    const [headerRow, ...dataRows] = rows;
    if (!headerRow.length) {
      throw new Error('No headers found in PBI source');
    }
    const resolvedHeaders = headerRow.map((header) => header.trim());
    const finalMapping = this.autoMapHeaders(resolvedHeaders, mapping);
    const seenExternalIds = new Set<string>();
    const parsed: Array<PBIRecord> = [];

    dataRows.forEach((cells, index) => {
      const sourceRowNumber = index + 2;
      const row = this.rowToMap(resolvedHeaders, cells);
      const externalId = this.pickCell(row, finalMapping.externalId);
      const title = this.pickCell(row, finalMapping.title);
      const description = this.pickCell(row, finalMapping.description);
      const acceptanceCriteria = this.pickCell(row, finalMapping.acceptanceCriteria);
      const workItemType = this.pickCell(row, finalMapping.type);
      const priority = normalizePriority(this.pickCell(row, finalMapping.priority));
      const parentExternalId = this.pickCell(row, finalMapping.parentExternalId);
      const rawDescription = sanitizeText(description);
      const rawAcceptanceCriteria = sanitizeText(acceptanceCriteria);
      const descriptionText = stripHtml(description);
      const acceptanceCriteriaText = stripHtml(acceptanceCriteria);
      const titleParts = splitTitle(title);

      let validationStatus = PBIValidationStatus.CANDIDATE;
      let validationReason: string | undefined;
      if (!externalId || !titleParts[0]) {
        validationStatus = PBIValidationStatus.MALFORMED;
        validationReason = 'Missing external id or title';
      } else if (isTechnicalRow(titleParts[0], workItemType)) {
        validationStatus = PBIValidationStatus.IGNORED;
        validationReason = 'Rule-based technical ignore';
      } else if (seenExternalIds.has(externalId.toLowerCase())) {
        validationStatus = PBIValidationStatus.DUPLICATE;
        validationReason = 'Duplicate external id';
      }

      if (validationStatus === PBIValidationStatus.CANDIDATE) {
        seenExternalIds.add(externalId.toLowerCase());
      }

      parsed.push({
        id: randomUUID(),
        batchId: '',
        sourceRowNumber,
        externalId,
        title: titleParts[0] || `Row ${sourceRowNumber}`,
        description: titleParts.length ? this.summarizeDescription(rawDescription || descriptionText) : undefined,
        state: validationStatus,
        priority,
        workItemType,
        title1: titleParts[0],
        title2: titleParts[1],
        title3: titleParts[2],
        rawDescription,
        rawAcceptanceCriteria,
        descriptionText,
        acceptanceCriteriaText,
        parentExternalId,
        validationStatus,
        validationReason
      });
    });

    return parsed;
  }

  private autoMapHeaders(headers: string[], mapping: PBIFieldMapping): PBIFieldMapping {
    const normalizedHeaders = headers.map((value) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' '));
    const resolved = { ...mapping };

    CSV_HEADER_ALIAS_BUCKETS.forEach(({ key, keys }) => {
      if ((resolved[key] ?? '').trim()) {
        return;
      }
      const found = normalizedHeaders.find((header) => {
        const normalized = header.toLowerCase();
        return keys.some((alias) => normalized.includes(alias));
      });
      if (found) {
        resolved[key] = found;
      }
    });

    if (!resolved.externalId && headers.length > 0) {
      resolved.externalId = headers[0];
    }
    if (!resolved.title && headers.length > 1) {
      resolved.title = headers[1];
    }
    if (!resolved.description && headers.length > 2) {
      resolved.description = headers[2];
    }
    return resolved;
  }

  private parseCsvRows(sourceContent: string): string[][] {
    const rows: string[][] = [];
    let cursor = 0;
    let field = '';
    let row: string[] = [];
    let inQuotes = false;
    const text = sourceContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    while (cursor < text.length) {
      const char = text[cursor];
      const next = text[cursor + 1];
      if (char === '"') {
        if (inQuotes && next === '"') {
          field += '"';
          cursor += 2;
          continue;
        }
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push(field);
        field = '';
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (field.length || row.length) {
          row.push(field);
          rows.push(row.map((value) => value.trim()));
          row = [];
          field = '';
        }
        if (char === '\r' && next === '\n') {
          cursor += 1;
        }
      } else {
        field += char;
      }
      cursor += 1;
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row.map((value) => value.trim()));
    }
    return rows.filter((row) => row.some((value) => value));
  }

  private parseHtmlRows(sourceContent: string): string[][] {
    const tables = sourceContent.match(HTML_TABLE_RE);
    if (!tables?.length) {
      throw new Error('No HTML table found for PBI import');
    }
    const match = tables[0];
    const rows: string[][] = [];
    const cellText = (value: string) => value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const rowMatcher = /<tr[\s\S]*?<\/tr>/gi;
    const cellMatcher = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    const rowMatches = match.match(rowMatcher) ?? [];
    for (const rowValue of rowMatches) {
      const rowCells: string[] = [];
      const cellMatches = rowValue.match(cellMatcher) ?? [];
      for (const cell of cellMatches) {
        const inner = cell.replace(/<\/?t[hd][^>]*>/gi, '');
        rowCells.push(cellText(inner));
      }
      if (rowCells.length) {
        rows.push(rowCells);
      }
    }
    if (!rows.length) {
      throw new Error('No rows found in HTML table');
    }
    return rows.filter((row) => row.some((value) => value));
  }

  private rowToMap(headers: string[], row: string[]): ParsedRow {
    const map: ParsedRow = {};
    headers.forEach((header, index) => {
      map[header] = row[index] ?? '';
    });
    return map;
  }

  private pickCell(row: ParsedRow, headerName?: string): string {
    if (!headerName) {
      return '';
    }
    const exact = row[headerName];
    if (exact !== undefined) {
      return exact.trim();
    }

    const normalizedHeader = headerName.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const key = Object.keys(row).find((candidate) => {
      return candidate.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ') === normalizedHeader;
    });
    return key ? (row[key] ?? '').trim() : '';
  }

  private summarizeDescription(value: string): string {
    if (!value) {
      return '';
    }
    return value.length > 360 ? `${value.slice(0, 357)}...` : value;
  }

  private sanitizeFilename(fileName: string): string {
    return fileName
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || randomUUID();
  }

  private classifyRows(records: Array<PBIRecord>): Array<PBIRecord> {
    return records;
  }
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function sanitizeText(input: string): string {
  if (!input) {
    return '';
  }
  return input.trim();
}

function splitTitle(title: string): [string, string | undefined, string | undefined] {
  const normalized = stripHtml(title || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return ['', undefined, undefined];
  }
  const parts = normalized.split(/(?:(?:\s*[:\-/]\s*)|(?:\s+[–—-]\s+))/).map((part) => part.trim());
  return [parts[0], parts[1], parts[2]];
}

function normalizePriority(value: string): 'low' | 'medium' | 'high' | 'urgent' | undefined {
  const key = value.trim().toLowerCase();
  return PRIORITY_ORDER[key];
}

function isTechnicalRow(title: string, type?: string): boolean {
  const normalizedTitle = title.toLowerCase();
  if (type && TECHNICAL_TYPES.has(type.trim().toLowerCase())) {
    if (!normalizedTitle.includes('customer') && !normalizedTitle.includes('user') && !normalizedTitle.includes('kb')) {
      return true;
    }
  }
  return IGNORE_KEYWORDS.some((keyword) => normalizedTitle.includes(keyword));
}
