// 入力経路（markdown 直貼り / file 添付）の解決と、ファイル本体のダウンロード。
//
// 分岐は「Markdown 文字列を得る」この冒頭だけに閉じ込める。ここから先
// （ブロック組み立て・投稿・編集・Datastore 保存）は経路に依らず共通。

import type { Client } from "./client.ts";

// markdown ブロックの 1 メッセージ上限。ファイル経路はこれに当たり得るため
// 関数内でガードする（超過は拒否）。直貼り経路は OpenForm 側の maxLength で
// 既に 3,000 字に制限されている。
export const MARKDOWN_MAX_LEN = 12000;

export type SourceInputs = {
  markdown?: string;
  file?: string[];
};

export type SourceResolution =
  | { kind: "markdown"; markdown: string }
  | { kind: "file"; fileId: string }
  | { kind: "error"; message: string };

// markdown と file の排他（XOR）を判定する純粋関数。
export function resolveSource(inputs: SourceInputs): SourceResolution {
  const markdown = inputs.markdown ?? "";
  const hasMarkdown = markdown.trim() !== "";
  const hasFile = (inputs.file?.length ?? 0) > 0;

  if (hasMarkdown && hasFile) {
    return {
      kind: "error",
      message:
        "Markdown の直貼りとファイル添付は同時に使えません。どちらか一方だけにしてください。",
    };
  }
  if (!hasMarkdown && !hasFile) {
    return {
      kind: "error",
      message:
        "Markdown を直接貼り付けるか、Markdown ファイルを添付してください。",
    };
  }
  if (hasFile) {
    return { kind: "file", fileId: inputs.file![0] };
  }
  return { kind: "markdown", markdown };
}

export type LengthCheck =
  | { ok: true; text: string }
  | { ok: false; message: string };

// 12,000 字上限を検証する純粋関数。超過は拒否（切り捨てない）。
export function enforceLengthLimit(text: string): LengthCheck {
  if (text.length > MARKDOWN_MAX_LEN) {
    return {
      ok: false,
      message:
        `Markdown が長すぎます（${text.length} 字）。上限は ${MARKDOWN_MAX_LEN} 字です。`,
    };
  }
  return { ok: true, text };
}

export type FileTextResult =
  | { ok: true; text: string }
  | { ok: false; message: string };

// 添付ファイルの本体をテキストとして取得する。
// files.info で url_private_download を引き、bot token 付きで fetch して
// UTF-8 デコードする。テキスト系以外は弾く。
export async function downloadFileText(
  client: Client,
  token: string,
  fileId: string,
  // テスト用に fetch を差し替え可能にする。
  fetchFn: typeof fetch = fetch,
): Promise<FileTextResult> {
  const info = await client.files.info({ file: fileId });
  if (!info.ok || !info.file) {
    return {
      ok: false,
      message: `ファイル情報を取得できませんでした: ${
        info.error ?? "unknown error"
      }`,
    };
  }

  const file = info.file as {
    url_private_download?: string;
    url_private?: string;
    mimetype?: string;
  };

  // テキスト以外（画像・PDF 等）はデコードしても意味が無いので拒否する。
  if (file.mimetype && !file.mimetype.startsWith("text/")) {
    return {
      ok: false,
      message:
        `テキストファイルを添付してください（受信した種別: ${file.mimetype}）。`,
    };
  }

  const url = file.url_private_download ?? file.url_private;
  if (!url) {
    return {
      ok: false,
      message: "ファイルのダウンロード URL が見つかりません。",
    };
  }

  const res = await fetchFn(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    return {
      ok: false,
      message: `ファイルのダウンロードに失敗しました（HTTP ${res.status}）。`,
    };
  }

  return { ok: true, text: await res.text() };
}
