// 展開後のブロック数を投稿前に見積もる。
//
// Slack は markdown ブロックを 1 ブロックのまま扱わず、サーバ側で展開する。
// 見出しと区切り線はそれぞれ独立したブロックになり、その間の連続する本文
// （段落・リスト・コードブロック・引用）はまとめて 1 ブロックになる。
// 展開後の総数が 50 を超えると chat.postMessage が invalid_blocks を返す
// （response_metadata: "no more than 50 items allowed [json-pointer:/blocks]"）。
//
// 送信するブロック数は 20 個程度でも展開後に 50 を超えることがあり、送信側の
// 数を見ていても気づけない。そのため投稿前にここで見積もり、超える場合は
// 投稿せずに、どこを削ればよいかを添えて利用者へ返す。
//
// 展開規則は実測で確かめた（成功する最大が 50、失敗する最小が 53）。

export const MAX_EXPANDED_BLOCKS = 50;

export type BlockBudget = {
  // 展開後の推定ブロック数（下の内訳の合計）。
  total: number;
  headings: number;
  dividers: number;
  // 見出し・区切り線で区切られた本文のかたまり。
  textRuns: number;
  tables: number;
  // context（投稿者）や actions（ボタン）など、展開されないブロック。
  other: number;
};

// markdown ブロック 1 個が展開されるブロック数を、内訳つきで数える。
function countMarkdownExpansion(
  text: string,
): Pick<BlockBudget, "headings" | "dividers" | "textRuns"> {
  let headings = 0;
  let dividers = 0;
  let textRuns = 0;
  // コードフェンスの中は見出しや区切り線に見える行があっても本文として扱う。
  let inFence = false;
  // 直前が本文で、まだ見出し・区切り線に区切られていない状態か。
  let inRun = false;

  for (const line of text.split("\n")) {
    const s = line.trim();

    if (s.startsWith("```")) {
      inFence = !inFence;
      if (!inRun) {
        textRuns++;
        inRun = true;
      }
      continue;
    }
    if (inFence) continue;
    // 空行は本文のかたまりを終わらせない（段落が続いても 1 ブロックにまとまる）。
    if (s === "") continue;

    if (/^#{1,6}\s/.test(s)) {
      headings++;
      inRun = false;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(s)) {
      dividers++;
      inRun = false;
      continue;
    }
    if (!inRun) {
      textRuns++;
      inRun = true;
    }
  }

  return { headings, dividers, textRuns };
}

// 送信するブロック列から、Slack 側で展開された後のブロック数を見積もる。
export function estimateExpandedBlocks(
  blocks: ReadonlyArray<{ type?: unknown; text?: unknown }>,
): BlockBudget {
  const budget: BlockBudget = {
    total: 0,
    headings: 0,
    dividers: 0,
    textRuns: 0,
    tables: 0,
    other: 0,
  };

  for (const block of blocks) {
    if (block.type === "markdown" && typeof block.text === "string") {
      const { headings, dividers, textRuns } = countMarkdownExpansion(
        block.text,
      );
      budget.headings += headings;
      budget.dividers += dividers;
      budget.textRuns += textRuns;
    } else if (block.type === "table") {
      budget.tables++;
    } else {
      budget.other++;
    }
  }

  budget.total = budget.headings + budget.dividers + budget.textRuns +
    budget.tables + budget.other;
  return budget;
}

// 上限を超えたときに利用者へ返す案内。何がいくつあるかを示し、削る候補を
// 単価の高い順（区切り線・見出し）に並べる。
export function buildBlockLimitMessage(budget: BlockBudget): string {
  return [
    `Markdown が Slack の上限を超えています（展開後 ${budget.total} ブロック / 上限 ${MAX_EXPANDED_BLOCKS}）。`,
    `Slack は見出しと区切り線をそれぞれ 1 ブロックに展開します。`,
    `内訳: 見出し ${budget.headings} / 区切り線 ${budget.dividers} / 本文 ${budget.textRuns} / テーブル ${budget.tables}。`,
    `区切り線（---）を削る、見出しを減らす、ファイルを分割する、のいずれかで ${
      budget.total - MAX_EXPANDED_BLOCKS
    } ブロック以上減らしてください。`,
  ].join("\n");
}

export type BudgetCheck =
  | { ok: true }
  | { ok: false; budget: BlockBudget; message: string };

export function checkBlockBudget(
  blocks: ReadonlyArray<{ type?: unknown; text?: unknown }>,
): BudgetCheck {
  const budget = estimateExpandedBlocks(blocks);
  if (budget.total <= MAX_EXPANDED_BLOCKS) return { ok: true };
  return { ok: false, budget, message: buildBlockLimitMessage(budget) };
}
