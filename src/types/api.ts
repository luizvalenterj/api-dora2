import type { ReturnType as SearchReturnType } from "../schemas/search.schema.js";

export interface ConvenioItem {
  id: number;
  nome: string;
}

export interface PlanoItem {
  id: number;
  nome: string;
  id_convenio: number;
  nome_convenio: string;
}

export interface UnidadeItem {
  id: number;
  nome: string;
  cidade: string;
  bairro: string;
}

export interface RecordItem {
  objectID: string;
  id_convenio: number;
  nome_convenio: string;
  id_plano: number;
  nome_plano: string;
  id_unidade: number;
  nome_unidade: string;
  cidade: string;
  bairro: string;
  servicos: string[];
}

export type SearchItem = ConvenioItem | PlanoItem | UnidadeItem | RecordItem | string;

export interface SearchMeta {
  nb_hits: number;
  processing_time_ms: number;
}

export interface SearchSuccessResponse {
  success: true;
  return_type: SearchReturnType;
  count: number;
  items: SearchItem[];
  meta: SearchMeta;
}
