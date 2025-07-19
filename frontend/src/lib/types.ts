// --- STATE & METADATA ---
export interface UserCommitmentInfo {
  value: string;
  leaf_index: number;
}

export interface UserMetadata {
  last_used_nullifier_nonce: number;
  commitment_info: UserCommitmentInfo | null;
}

// --- API RESPONSE TYPES ---
export interface ApiPosition {
  position_id: string;
  is_long: boolean;
  entry_price: string;
  margin: string;
  size: string;
}

export interface HistoricalPosition {
  position_id: string;
  is_long: boolean;
  entry_price: string;
  margin: string;
  size: string;
  status: "Closed" | "Liquidated";
  final_pnl: string;
}

export interface ApiNote {
  note_id: string;
  note_nonce: number;
  value: string;
  receiver_hash: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  has_more: boolean;
  next_cursor: string | null;
}


export type AppState = 'IDLE' | 'LOADING' | 'FOUND_OPEN' | 'FOUND_HISTORICAL' | 'NOT_FOUND';

export interface BasePositionData {
  position_id: string;
  is_long: boolean;
  size: string;
  margin: string;
  entry_price: string;
}

export interface OpenPosition extends BasePositionData {
  pnl: string;
  liquidation_price: string;
}

export interface HistoricalPosition extends BasePositionData {
  final_pnl: string;
}

export type Position =
  | { status: 'Open'; data: OpenPosition }
  | { status: 'Closed' | 'Liquidated'; data: HistoricalPosition };

export interface PositionApiResponse {
  position: Position; // The union type you already defined
}
  
