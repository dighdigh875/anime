import { getDb } from './db';

export interface AnimeMapping { reanimeId: string; episodeOffset: number }

async function mappingDb() {
  const sql = getDb();
  if (!sql) throw new Error('작품 연결을 저장하려면 Vercel에 Neon 데이터베이스를 연결해 주세요.');
  // Idempotent, including a fresh Vercel deployment. Never report a failed save as success.
  await sql`CREATE TABLE IF NOT EXISTS anissia_reanime_mappings (
    user_id VARCHAR(100) NOT NULL,
    anissia_id INTEGER NOT NULL,
    reanime_id VARCHAR(255) NOT NULL,
    episode_offset INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, anissia_id)
  )`;
  return sql;
}

export async function getAnimeMapping(userId: string, animeNo: number): Promise<AnimeMapping | null> {
  const sql = await mappingDb();
  const rows = await sql`SELECT reanime_id, episode_offset FROM anissia_reanime_mappings WHERE user_id=${userId} AND anissia_id=${animeNo}`;
  return rows[0] ? {reanimeId: String(rows[0].reanime_id), episodeOffset: Number(rows[0].episode_offset)} : null;
}

export async function saveAnimeMapping(userId: string, animeNo: number, mapping: AnimeMapping) {
  const sql = await mappingDb();
  await sql`INSERT INTO anissia_reanime_mappings (user_id, anissia_id, reanime_id, episode_offset)
    VALUES (${userId}, ${animeNo}, ${mapping.reanimeId}, ${mapping.episodeOffset})
    ON CONFLICT (user_id, anissia_id) DO UPDATE SET reanime_id=EXCLUDED.reanime_id,
      episode_offset=EXCLUDED.episode_offset, updated_at=CURRENT_TIMESTAMP`;
}
