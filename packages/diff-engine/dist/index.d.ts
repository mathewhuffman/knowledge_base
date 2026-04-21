export declare const DIFF_ENGINE_VERSION = "0.2.0";
export interface DiffLineChange {
    kind: 'added' | 'removed' | 'unchanged';
    beforeLineNumber?: number;
    afterLineNumber?: number;
    content: string;
}
export interface DiffRenderedBlock {
    kind: 'added' | 'removed' | 'unchanged';
    beforeText?: string;
    afterText?: string;
}
export interface DiffChangeRegion {
    id: string;
    kind: 'added' | 'removed' | 'changed';
    label: string;
    beforeText?: string;
    afterText?: string;
    beforeLineStart?: number;
    beforeLineEnd?: number;
    afterLineStart?: number;
    afterLineEnd?: number;
}
export interface DiffGutterItem {
    lineNumber: number;
    kind: 'added' | 'removed' | 'changed';
    regionId: string;
    side: 'before' | 'after';
}
export interface HtmlDiffResult {
    beforeHtml: string;
    afterHtml: string;
    sourceLines: DiffLineChange[];
    renderedBlocks: DiffRenderedBlock[];
    changeRegions: DiffChangeRegion[];
    gutter: DiffGutterItem[];
}
export declare function diffHtml(beforeHtml: string, afterHtml: string): HtmlDiffResult;
