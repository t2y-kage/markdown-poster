// Slack API 失敗時の詳細をログへ出す補助。
//
// `invalid_blocks` や `msg_too_long` のようなエラーコードだけでは、どのブロックの
// 何が問題なのか分からない。Slack は多くの場合 `response_metadata.messages` に
// 具体的な理由を返すため、それをそのまま出力する。`slack run` で起動していれば
// ターミナルに、デプロイ後は `slack activity` に出る。
//
// 本文そのものは出さない（内容が長く、ログとしても扱いに困るため）。代わりに
// ブロック構成の内訳だけを出して、失敗したペイロードの形が分かるようにする。

export type BlockSummary = { total: number; types: Record<string, number> };

// ブロック列を「種別ごとの個数」に畳む。
export function summarizeBlocks(
  blocks: ReadonlyArray<{ type?: unknown }>,
): BlockSummary {
  const types: Record<string, number> = {};
  for (const block of blocks) {
    const type = typeof block.type === "string" ? block.type : "unknown";
    types[type] = (types[type] ?? 0) + 1;
  }
  return { total: blocks.length, types };
}

type ApiFailure = {
  error?: string;
  warning?: string;
  response_metadata?: unknown;
};

// 失敗レスポンスから、ログに出す情報だけを取り出す純粋関数。
export function buildFailureLog(
  api: string,
  response: unknown,
  blocks?: ReadonlyArray<{ type?: unknown }>,
): Record<string, unknown> {
  const { error, warning, response_metadata } = (response ?? {}) as ApiFailure;
  return {
    api,
    error: error ?? "unknown error",
    ...(warning ? { warning } : {}),
    ...(response_metadata ? { response_metadata } : {}),
    ...(blocks ? { blocks: summarizeBlocks(blocks) } : {}),
  };
}

export function logApiFailure(
  api: string,
  response: unknown,
  blocks?: ReadonlyArray<{ type?: unknown }>,
): void {
  console.log(
    `[markdown-poster] ${
      JSON.stringify(buildFailureLog(api, response, blocks))
    }`,
  );
}
