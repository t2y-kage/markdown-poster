# アーキテクチャ図

DESIGN.md の「3. アーキテクチャ」から参照している図と、その生成元を置いている。

## ファイル

- `markdown-poster.architecture.json`：図の定義。この JSON が正で、PNG は生成物。
- `architecture-light.png`、`architecture-dark.png`：DESIGN.md から参照する画像。GitHub の配色設定に応じて切り替わる。

## 前提

図の生成には [archify](https://github.com/tt-a1i/archify) を使う。
Claude Code の skill として `~/.claude/skills/archify` に置いてあり、Node.js 18 以上と Google Chrome が要る。
リポジトリの依存には含めていないので、`deno task test` や CI では生成しない。

## 再生成の手順

図の内容を変えるときは `markdown-poster.architecture.json` を編集する。
コードの構成が変わったときは `meta.repository.revision` を現在のコミットハッシュに更新する。
各ノードの `sources` に書いたパスは実在チェックの対象なので、ファイルをリネームしたらここも直す。

編集したら検証する。

```bash
REPO=$(git rev-parse --show-toplevel)
SPEC="$REPO/docs/architecture/markdown-poster.architecture.json"

cd ~/.claude/skills/archify
node bin/archify.mjs validate architecture "$SPEC" \
  --quality showcase --repo-root "$REPO" --json
```

9 項目の検査すべてが通り、composition のエラーと警告が 0 になるまで直す。
診断は `subject` で対象の接続やノードを指し、`supportedFixes` に取れる手段を並べてくる。

通ったら HTML を生成する。

```bash
node bin/archify.mjs deliver architecture "$SPEC" /tmp/architecture.html \
  --quality showcase --repo-root "$REPO" --json
```

HTML はリポジトリに置いていないので、出力先は作業ディレクトリでよい。

PNG は生成した HTML から書き出す。
ブラウザで `/tmp/architecture.html` を開き、右上の Export から PNG を選ぶ。
テーマを Light と Dark に切り替えて 2 枚書き出し、`architecture-light.png` と `architecture-dark.png` としてこのディレクトリに置く。

最後に `deno fmt docs/architecture` を実行する。
JSON は `deno fmt` の整形対象なので、忘れると `deno task test` が落ちる。

## 注意

生成した HTML をこのディレクトリに置くなら、`deno.jsonc` の `fmt.exclude` に加える。
`deno fmt` は HTML も整形対象にし、整形すると archify が発行した sha256 と一致しなくなって受入証跡の意味がなくなる。

ビューアの固定 UI（Export、Legend など）は英語で表示される。
archify が `meta.locale` に `en` と `zh-CN` しか持たず、日本語は英語にフォールバックするため。
図の中身は日本語で書いている。
