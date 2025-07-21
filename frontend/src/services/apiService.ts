import { ApiNote, ApiPosition, HistoricalPosition, PaginatedResponse, PositionApiResponse } from '@/lib/types';
import axios from 'axios';

// const INDEXER_API_URL = import.meta.env.VITE_INDEXER_API_URL || "https://indexer-server-production-b55a.up.railway.app";
const INDEXER_API_URL = import.meta.env.VITE_INDEXER_API_URL || "http://localhost:3000";

const apiClient = axios.create({
  baseURL: INDEXER_API_URL,
});

// A central place for all API calls
export const apiService = {
  // --- Metadata Endpoints ---
  getMetadata: async (authHeaders: any) => {
    const { data } = await apiClient.get<{ encrypted_metadata: string | null }>('/private/metadata', { headers: authHeaders });
    return data;
  },

  postMetadata: async (encryptedBlob: string, authHeaders: any) => {
    await apiClient.post('/private/metadata', encryptedBlob, { 
      headers: { ...authHeaders, 'Content-Type': 'text/plain' }
    });
  },

  getPositionById: async (positionId: string) => {
    const { data } = await apiClient.get<PositionApiResponse>(`/positions/${positionId}`);
    console.log("position requested", data);
    return data;
  },

  // --- Public Position Endpoints ---
  getPublicOpenPositions: async (address: string) => {
    const { data } = await apiClient.get<{ open_positions: ApiPosition[] }>(`/positions/open/${address}`);
    return data.open_positions;
  },

  getPublicHistoricalPositions: async (address: string, cursor?: string) => {
    const { data } = await apiClient.get<PaginatedResponse<HistoricalPosition>>(`/positions/history/${address}`, {
      params: { cursor, page_size: 20 },
    });
    return data;
  },

  

  // --- Private (Authenticated) Position Endpoints ---
  getPrivateOpenPositions: async (authHeaders: any) => {
    const { data } = await apiClient.get<{ open_positions: ApiPosition[] }>('/private/positions/open', { headers: authHeaders });
    return data.open_positions;
  },

  // --- Note Endpoint ---
  getUnspentNotes: async (receiverHash: string) => {
    const { data } = await apiClient.get<{ unspent_notes: ApiNote[] }>('/private/notes/unspent', {
      headers: { 'X-Receiver-Hash': receiverHash },
    });
    return data.unspent_notes;
  },

  getPrivateHistoricalPositions: async (authHeaders: any, cursor?: string) => {
    console.log("Fetching private historical positions...");
    const { data } = await apiClient.get<PaginatedResponse<HistoricalPosition>>('/private/positions/history', {
      headers: authHeaders,
      params: { cursor, page_size: 20 },
    });
    return data;
  },

  
};