// Shapes of the smart import API (apps/api/src/listings/import)

export type FieldType =
  | 'size' | 'brand' | 'pattern' | 'qty' | 'dot_year' | 'condition' | 'country' | 'region' | 'price' | 'currency'
  | 'sku' | 'load_index' | 'origin_country' | 'tire_type' | 'comment' | 'ignore';

export const FIELD_LABELS: Record<FieldType, string> = {
  size: 'Size',
  brand: 'Brand',
  pattern: 'Pattern',
  qty: 'Quantity',
  dot_year: 'Year / DOT',
  condition: 'Condition',
  country: 'Stock country',
  region: 'Stock region',
  price: 'Price',
  currency: 'Currency',
  sku: 'SKU / article',
  load_index: 'Load index / ply',
  origin_country: 'Made in',
  tire_type: 'Tyre type',
  comment: 'Comment',
  ignore: '— ignore —',
};

/** Types a file may map to several columns */
export const MULTI_COLUMN: FieldType[] = ['size', 'comment', 'ignore'];

export interface ColumnGuess {
  index: number;
  header: string;
  type: FieldType;
  confidence: number;
  samples: string[];
  glued: boolean;
  alternatives: { type: FieldType; confidence: number }[];
}

export interface AnalyzeResult {
  file_type: 'xlsx' | 'csv';
  sheets: { name: string; rows: number }[];
  sheet: string;
  header_row: number;
  header: string[];
  data_rows: number;
  columns: ColumnGuess[];
  saved_mapping: boolean;
  header_signature: string;
}

export interface RowData {
  brand?: string;
  size?: string;
  additional_sizes?: string[];
  pattern?: string;
  qty?: number;
  dot_code?: string;
  condition?: string;
  location_country?: string;
  location_region?: string;
  price?: number;
  currency?: string;
  sku?: string;
  load_index?: string;
  origin_country?: string;
  tire_type?: string;
  comment?: string;
}

export interface RowMessage {
  level: 'warning' | 'error';
  field?: string;
  text: string;
}

export type RowStatus = 'ok' | 'warning' | 'error';
export type RowAction = 'new' | 'update' | 'unchanged' | 'skip';

export interface PreviewRow {
  row: number;
  data: RowData;
  status: RowStatus;
  messages: RowMessage[];
  action: RowAction | null;
  unrecognized: string | null;
  alternatives?: { field: 'size' | 'price'; value: string; label: string }[];
  /** Changed in the browser since the server last checked it */
  edited?: boolean;
}

export interface PlanSummary {
  rows: number;
  new: number;
  update: number;
  unchanged: number;
  skip: number;
  errors: number;
  warnings: number;
  missing: number;
}

export interface PreviewResult {
  rows: PreviewRow[];
  summary: PlanSummary;
  skipped_empty: number;
  hints: string[];
}

export interface CommitResult {
  dry_run: boolean;
  batch_id: string | null;
  counts: { created: number; updated: number; unchanged: number; deactivated: number; skipped: number };
  summary: PlanSummary;
  errors: { row: number; messages: string[] }[];
  errors_csv: string | null;
  rows?: Pick<PreviewRow, 'row' | 'status' | 'messages' | 'action'>[];
}
