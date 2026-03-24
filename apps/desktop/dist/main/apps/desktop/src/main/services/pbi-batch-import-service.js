"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PBIBatchImportService = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const shared_types_1 = require("@kb-vault/shared-types");
const logger_1 = require("./logger");
const HTML_TABLE_RE = /<table[\s\S]*?<\/table>/gi;
const CSV_HEADER_ALIAS_BUCKETS = [
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
const PRIORITY_ORDER = {
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
class PBIBatchImportService {
    workspaceRepository;
    constructor(workspaceRepository) {
        this.workspaceRepository = workspaceRepository;
    }
    async importBatch(input) {
        const workspaceId = input.workspaceId;
        const sourceFormat = this.resolveSourceFormat(input);
        const workspace = await this.workspaceRepository.getWorkspace(workspaceId);
        logger_1.logger.info('pbi.import.start', {
            workspaceId,
            sourceFileName: input.sourceFileName,
            sourceFormat
        });
        const rawSource = await this.loadRawSource(input.sourcePath, input.sourceContent, input.sourceFileName);
        const preservedPath = await this.persistRawSource(workspace.path, workspaceId, rawSource, input.sourceFileName, sourceFormat);
        const records = this.parseRows(rawSource, sourceFormat, this.resolveMapping(input.fieldMapping));
        const normalized = this.classifyRows(records);
        const candidateRows = normalized.filter((row) => row.validationStatus === shared_types_1.PBIValidationStatus.CANDIDATE);
        const malformedRows = normalized.filter((row) => row.validationStatus === shared_types_1.PBIValidationStatus.MALFORMED);
        const duplicateRows = normalized.filter((row) => row.validationStatus === shared_types_1.PBIValidationStatus.DUPLICATE);
        const ignoredRows = normalized.filter((row) => row.validationStatus === shared_types_1.PBIValidationStatus.IGNORED);
        const batchName = input.batchName?.trim() || this.defaultBatchName(input.sourceFileName);
        const counts = {
            candidateRowCount: candidateRows.length,
            malformedRowCount: malformedRows.length,
            duplicateRowCount: duplicateRows.length,
            ignoredRowCount: ignoredRows.length,
            scopedRowCount: candidateRows.length
        };
        const scopeMode = input.scope?.mode ?? shared_types_1.PBIBatchScopeMode.ALL;
        const duplicateBatch = await this.workspaceRepository.findDuplicatePBIBatch(workspaceId, input.sourceFileName, records.length, {
            candidateRowCount: candidateRows.length,
            malformedRowCount: malformedRows.length,
            duplicateRowCount: duplicateRows.length,
            ignoredRowCount: ignoredRows.length
        });
        if (duplicateBatch) {
            logger_1.logger.warn('pbi.import.recent_duplicate_detected', {
                workspaceId,
                existingBatchId: duplicateBatch.id,
                existingBatchName: duplicateBatch.name,
                sourceFileName: input.sourceFileName
            });
        }
        const createdBatch = await this.workspaceRepository.createPBIBatch(workspaceId, batchName, input.sourceFileName, preservedPath, sourceFormat, normalized.length, counts, scopeMode);
        await this.workspaceRepository.insertPBIRecords(workspaceId, createdBatch.id, normalized);
        await this.workspaceRepository.linkPBIRecordParents(workspaceId, createdBatch.id);
        const scopeResult = await this.workspaceRepository.setPBIBatchScope(workspaceId, createdBatch.id, scopeMode, input.scope?.selectedRows ?? [], input.scope?.selectedExternalIds ?? []);
        const batch = await this.workspaceRepository.getPBIBatch(workspaceId, createdBatch.id);
        logger_1.logger.info('pbi.import.completed', {
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
    async getBatchPreflight(workspaceId, batchId) {
        const batch = await this.workspaceRepository.getPBIBatch(workspaceId, batchId);
        const allRows = await this.workspaceRepository.getPBIRecords(workspaceId, batchId);
        const candidateRows = allRows.filter((row) => row.validationStatus === shared_types_1.PBIValidationStatus.CANDIDATE);
        const invalidRows = allRows.filter((row) => row.validationStatus === shared_types_1.PBIValidationStatus.MALFORMED);
        const duplicateRows = allRows.filter((row) => row.validationStatus === shared_types_1.PBIValidationStatus.DUPLICATE);
        const ignoredRows = allRows.filter((row) => row.validationStatus === shared_types_1.PBIValidationStatus.IGNORED);
        const scopedRows = candidateRows
            .filter((row) => String(row.state ?? 'candidate') === 'candidate')
            .map((row) => row.sourceRowNumber)
            .filter((value) => value !== undefined);
        const scopePayload = {
            batchId,
            workspaceId,
            mode: (batch.scopeMode ?? shared_types_1.PBIBatchScopeMode.ALL),
            scopedRowNumbers: scopedRows,
            scopedCount: batch.scopedRowCount,
            updatedAtUtc: batch.importedAtUtc
        };
        const candidateTitles = candidateRows.slice(0, 8).map((row) => row.title ?? '').filter(Boolean);
        return { batch, candidateRows, invalidRows, duplicateRows, ignoredRows, scopePayload, candidateTitles };
    }
    resolveSourceFormat(input) {
        if (input.sourceFormat) {
            return input.sourceFormat;
        }
        const extension = node_path_1.default.extname(input.sourceFileName).toLowerCase().replace('.', '');
        if (extension === 'html' || extension === 'htm') {
            return shared_types_1.PBIImportFormat.HTML;
        }
        return shared_types_1.PBIImportFormat.CSV;
    }
    defaultBatchName(sourceFileName) {
        const normalized = node_path_1.default.basename(sourceFileName || '').trim();
        if (!normalized) {
            return `batch-${Date.now()}`;
        }
        return normalized.replace(/\.[^.]+$/, '') || `batch-${Date.now()}`;
    }
    async loadRawSource(sourcePath, sourceContent, fileName = 'upload') {
        if (sourceContent && sourceContent.trim()) {
            return sourceContent;
        }
        if (!sourcePath) {
            throw new Error('pbi.import requires sourcePath or sourceContent');
        }
        try {
            return await promises_1.default.readFile(sourcePath, 'utf8');
        }
        catch {
            throw new Error(`Unable to read source file ${fileName}`);
        }
    }
    async persistRawSource(workspacePath, workspaceId, sourceContent, sourceFileName, sourceFormat) {
        const batchFolder = (0, node_crypto_1.randomUUID)();
        const importDir = node_path_1.default.join(workspacePath, 'imports', batchFolder);
        await promises_1.default.mkdir(importDir, { recursive: true });
        const safeBaseName = this.sanitizeFilename(sourceFileName || `batch-${Date.now()}`);
        const ext = sourceFormat === shared_types_1.PBIImportFormat.CSV ? '.csv' : '.html';
        const destination = node_path_1.default.join(importDir, `${safeBaseName}${ext}`);
        await promises_1.default.writeFile(destination, sourceContent, 'utf8');
        logger_1.logger.info('pbi.import.persisted', {
            workspaceId,
            sourceFile: sourceFileName,
            persistedTo: destination
        });
        return node_path_1.default.relative(workspacePath, destination);
    }
    resolveMapping(inputMapping) {
        const mapping = {
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
            const provided = inputMapping[key];
            if (provided) {
                mapping[key] = provided;
            }
        });
        return mapping;
    }
    parseRows(sourceContent, format, mapping) {
        const rows = format === shared_types_1.PBIImportFormat.HTML ? this.parseHtmlRows(sourceContent) : this.parseCsvRows(sourceContent);
        const [headerRow, ...dataRows] = rows;
        if (!headerRow.length) {
            throw new Error('No headers found in PBI source');
        }
        const resolvedHeaders = headerRow.map((header) => header.trim());
        const finalMapping = this.autoMapHeaders(resolvedHeaders, mapping);
        const seenExternalIds = new Set();
        const parsed = [];
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
            let validationStatus = shared_types_1.PBIValidationStatus.CANDIDATE;
            let validationReason;
            if (!externalId || !titleParts[0]) {
                validationStatus = shared_types_1.PBIValidationStatus.MALFORMED;
                validationReason = 'Missing external id or title';
            }
            else if (isTechnicalRow(titleParts[0], workItemType)) {
                validationStatus = shared_types_1.PBIValidationStatus.IGNORED;
                validationReason = 'Rule-based technical ignore';
            }
            else if (seenExternalIds.has(externalId.toLowerCase())) {
                validationStatus = shared_types_1.PBIValidationStatus.DUPLICATE;
                validationReason = 'Duplicate external id';
            }
            if (validationStatus === shared_types_1.PBIValidationStatus.CANDIDATE) {
                seenExternalIds.add(externalId.toLowerCase());
            }
            parsed.push({
                id: (0, node_crypto_1.randomUUID)(),
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
    autoMapHeaders(headers, mapping) {
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
    parseCsvRows(sourceContent) {
        const rows = [];
        let cursor = 0;
        let field = '';
        let row = [];
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
            }
            else if (char === ',' && !inQuotes) {
                row.push(field);
                field = '';
            }
            else if ((char === '\n' || char === '\r') && !inQuotes) {
                if (field.length || row.length) {
                    row.push(field);
                    rows.push(row.map((value) => value.trim()));
                    row = [];
                    field = '';
                }
                if (char === '\r' && next === '\n') {
                    cursor += 1;
                }
            }
            else {
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
    parseHtmlRows(sourceContent) {
        const tables = sourceContent.match(HTML_TABLE_RE);
        if (!tables?.length) {
            throw new Error('No HTML table found for PBI import');
        }
        const match = tables[0];
        const rows = [];
        const cellText = (value) => value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const rowMatcher = /<tr[\s\S]*?<\/tr>/gi;
        const cellMatcher = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
        const rowMatches = match.match(rowMatcher) ?? [];
        for (const rowValue of rowMatches) {
            const rowCells = [];
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
    rowToMap(headers, row) {
        const map = {};
        headers.forEach((header, index) => {
            map[header] = row[index] ?? '';
        });
        return map;
    }
    pickCell(row, headerName) {
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
    summarizeDescription(value) {
        if (!value) {
            return '';
        }
        return value.length > 360 ? `${value.slice(0, 357)}...` : value;
    }
    sanitizeFilename(fileName) {
        return fileName
            .trim()
            .replace(/[^a-zA-Z0-9._-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80) || (0, node_crypto_1.randomUUID)();
    }
    classifyRows(records) {
        return records;
    }
}
exports.PBIBatchImportService = PBIBatchImportService;
function stripHtml(input) {
    return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function sanitizeText(input) {
    if (!input) {
        return '';
    }
    return input.trim();
}
function splitTitle(title) {
    const normalized = stripHtml(title || '').replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return ['', undefined, undefined];
    }
    const parts = normalized.split(/(?:(?:\s*[:\-/]\s*)|(?:\s+[–—-]\s+))/).map((part) => part.trim());
    return [parts[0], parts[1], parts[2]];
}
function normalizePriority(value) {
    const key = value.trim().toLowerCase();
    return PRIORITY_ORDER[key];
}
function isTechnicalRow(title, type) {
    const normalizedTitle = title.toLowerCase();
    if (type && TECHNICAL_TYPES.has(type.trim().toLowerCase())) {
        if (!normalizedTitle.includes('customer') && !normalizedTitle.includes('user') && !normalizedTitle.includes('kb')) {
            return true;
        }
    }
    return IGNORE_KEYWORDS.some((keyword) => normalizedTitle.includes(keyword));
}
