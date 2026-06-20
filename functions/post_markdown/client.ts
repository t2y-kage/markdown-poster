// deno_slack_api の SlackAPIClient 型を厳密に取り回す必要は無いため、必要な
// メソッドだけを使う最小の別名にする。ハンドラ・ヘルパ間で共有する。
// deno-lint-ignore no-explicit-any
export type Client = any;
