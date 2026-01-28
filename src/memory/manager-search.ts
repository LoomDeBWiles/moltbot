import type { DatabaseSync } from "node:sqlite";

import { truncateUtf16Safe } from "../utils.js";
import { cosineSimilarity, parseEmbedding } from "./internal.js";

const vectorToBlob = (embedding: number[]): Buffer =>
  Buffer.from(new Float32Array(embedding).buffer);

function buildProjectFilter(
  project: string | undefined,
  alias?: string,
): { sql: string; params: (string | null)[] } {
  if (project === undefined) return { sql: "", params: [] };
  const column = alias ? `${alias}.project` : "project";
  return { sql: ` AND (${column} = ? OR ? IS NULL)`, params: [project, project] };
}

export type SearchSource = string;

export type SearchRowResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: SearchSource;
};

export async function searchVector(params: {
  db: DatabaseSync;
  vectorTable: string;
  providerModel: string;
  queryVec: number[];
  limit: number;
  snippetMaxChars: number;
  ensureVectorReady: (dimensions: number) => Promise<boolean>;
  sourceFilterVec: { sql: string; params: SearchSource[] };
  sourceFilterChunks: { sql: string; params: SearchSource[] };
  project?: string;
}): Promise<SearchRowResult[]> {
  if (params.queryVec.length === 0 || params.limit <= 0) return [];
  const projectFilter = buildProjectFilter(params.project, "c");
  if (await params.ensureVectorReady(params.queryVec.length)) {
    const rows = params.db
      .prepare(
        `SELECT c.id, c.path, c.start_line, c.end_line, c.text,\n` +
          `       c.source,\n` +
          `       vec_distance_cosine(v.embedding, ?) AS dist\n` +
          `  FROM ${params.vectorTable} v\n` +
          `  JOIN chunks c ON c.id = v.id\n` +
          ` WHERE c.model = ?${params.sourceFilterVec.sql}${projectFilter.sql}\n` +
          ` ORDER BY dist ASC\n` +
          ` LIMIT ?`,
      )
      .all(
        vectorToBlob(params.queryVec),
        params.providerModel,
        ...params.sourceFilterVec.params,
        ...projectFilter.params,
        params.limit,
      ) as Array<{
      id: string;
      path: string;
      start_line: number;
      end_line: number;
      text: string;
      source: SearchSource;
      dist: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      startLine: row.start_line,
      endLine: row.end_line,
      score: 1 - row.dist,
      snippet: truncateUtf16Safe(row.text, params.snippetMaxChars),
      source: row.source,
    }));
  }

  const chunksProjectFilter = buildProjectFilter(params.project);
  const candidates = listChunks({
    db: params.db,
    providerModel: params.providerModel,
    sourceFilter: params.sourceFilterChunks,
    projectFilter: chunksProjectFilter,
  });
  const scored = candidates
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(params.queryVec, chunk.embedding),
    }))
    .filter((entry) => Number.isFinite(entry.score));
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, params.limit)
    .map((entry) => ({
      id: entry.chunk.id,
      path: entry.chunk.path,
      startLine: entry.chunk.startLine,
      endLine: entry.chunk.endLine,
      score: entry.score,
      snippet: truncateUtf16Safe(entry.chunk.text, params.snippetMaxChars),
      source: entry.chunk.source,
    }));
}

export function listChunks(params: {
  db: DatabaseSync;
  providerModel: string;
  sourceFilter: { sql: string; params: SearchSource[] };
  projectFilter?: { sql: string; params: (string | null)[] };
}): Array<{
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  embedding: number[];
  source: SearchSource;
}> {
  const projFilter = params.projectFilter ?? { sql: "", params: [] };
  const rows = params.db
    .prepare(
      `SELECT id, path, start_line, end_line, text, embedding, source\n` +
        `  FROM chunks\n` +
        ` WHERE model = ?${params.sourceFilter.sql}${projFilter.sql}`,
    )
    .all(params.providerModel, ...params.sourceFilter.params, ...projFilter.params) as Array<{
    id: string;
    path: string;
    start_line: number;
    end_line: number;
    text: string;
    embedding: string;
    source: SearchSource;
  }>;

  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    startLine: row.start_line,
    endLine: row.end_line,
    text: row.text,
    embedding: parseEmbedding(row.embedding),
    source: row.source,
  }));
}

export async function searchKeyword(params: {
  db: DatabaseSync;
  ftsTable: string;
  providerModel: string;
  query: string;
  limit: number;
  snippetMaxChars: number;
  sourceFilter: { sql: string; params: SearchSource[] };
  buildFtsQuery: (raw: string) => string | null;
  bm25RankToScore: (rank: number) => number;
  project?: string;
}): Promise<Array<SearchRowResult & { textScore: number }>> {
  if (params.limit <= 0) return [];
  const ftsQuery = params.buildFtsQuery(params.query);
  if (!ftsQuery) return [];

  const projectFilter = buildProjectFilter(params.project, "c");
  const needsJoin = params.project !== undefined;

  const sql = needsJoin
    ? `SELECT f.id, f.path, f.source, f.start_line, f.end_line, f.text,\n` +
      `       bm25(${params.ftsTable}) AS rank\n` +
      `  FROM ${params.ftsTable} f\n` +
      `  JOIN chunks c ON c.id = f.id\n` +
      ` WHERE ${params.ftsTable} MATCH ? AND f.model = ?${params.sourceFilter.sql}${projectFilter.sql}\n` +
      ` ORDER BY rank ASC\n` +
      ` LIMIT ?`
    : `SELECT id, path, source, start_line, end_line, text,\n` +
      `       bm25(${params.ftsTable}) AS rank\n` +
      `  FROM ${params.ftsTable}\n` +
      ` WHERE ${params.ftsTable} MATCH ? AND model = ?${params.sourceFilter.sql}\n` +
      ` ORDER BY rank ASC\n` +
      ` LIMIT ?`;

  const queryParams = needsJoin
    ? [
        ftsQuery,
        params.providerModel,
        ...params.sourceFilter.params,
        ...projectFilter.params,
        params.limit,
      ]
    : [ftsQuery, params.providerModel, ...params.sourceFilter.params, params.limit];

  const rows = params.db.prepare(sql).all(...queryParams) as Array<{
    id: string;
    path: string;
    source: SearchSource;
    start_line: number;
    end_line: number;
    text: string;
    rank: number;
  }>;

  return rows.map((row) => {
    const textScore = params.bm25RankToScore(row.rank);
    return {
      id: row.id,
      path: row.path,
      startLine: row.start_line,
      endLine: row.end_line,
      score: textScore,
      textScore,
      snippet: truncateUtf16Safe(row.text, params.snippetMaxChars),
      source: row.source,
    };
  });
}
