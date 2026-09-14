import { describe, expect, it } from "vitest";
import { parseMultiAccountError } from "./preflight.js";

// 実際にユーザーが遭遇した wrangler のエラーメッセージ（複数アカウント環境、非対話実行時）
const WRANGLER_MULTI_ACCOUNT_ERROR = `
✘ [ERROR] More than one account available but unable to select one in non-interactive mode.

  Please set the appropriate \`account_id\` in your Wrangler configuration file or assign it to the \`CLOUDFLARE_ACCOUNT_ID\` environment variable.
  Available accounts are (\`<name>\`: \`<account_id>\`):
    \`Agenda23@gmail.com's Account\`: \`59367e98606e7cc0734c621d4dcf73b5\`
    \`Masuofx@gmail.com's Account\`: \`50775492882c8b11c547dcfffc6f7b7a\`
`;

describe("parseMultiAccountError", () => {
  it("extracts account name/id pairs from wrangler's non-interactive multi-account error", () => {
    const accounts = parseMultiAccountError(WRANGLER_MULTI_ACCOUNT_ERROR);
    expect(accounts).toEqual([
      { name: "Agenda23@gmail.com's Account", id: "59367e98606e7cc0734c621d4dcf73b5" },
      { name: "Masuofx@gmail.com's Account", id: "50775492882c8b11c547dcfffc6f7b7a" },
    ]);
  });

  it("returns null for unrelated error text", () => {
    expect(parseMultiAccountError("some other wrangler error")).toBeNull();
  });

  it("returns null if the marker phrase is present but no accounts can be parsed", () => {
    expect(parseMultiAccountError("More than one account available but no list follows")).toBeNull();
  });
});
