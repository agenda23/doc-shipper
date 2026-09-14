import type { AuthCredentials } from "../types.js";

function jsStringLiteral(s: string): string {
  return JSON.stringify(s);
}

const HELPERS_JS = `
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function timingSafeEqualStr(a, b) {
  const encoder = new TextEncoder();
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length === bb.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] || 0) ^ (bb[i] || 0);
  }
  return diff === 0;
}
`.trim();

/**
 * Cloudflare Pages 用 _worker.js を生成する（§6.1）。
 * - mode "env": 認証情報は env（Cloudflare Secrets）から読む。成果物には残らない（cloudflare ターゲット用）。
 * - mode {user, pass}: dir/zip ターゲット用に直接埋め込む（デプロイ実行が無く Secrets を設定できないため。§7.5で平文残存を警告する前提）。
 */
export function generateCloudflareWorker(mode: "env" | AuthCredentials): string {
  const credsExpr =
    mode === "env"
      ? "`${env.BASIC_AUTH_USER}:${env.BASIC_AUTH_PASS}`"
      : jsStringLiteral(`${mode.user}:${mode.pass}`);

  return `${HELPERS_JS}

export default {
  async fetch(request, env) {
    const expected = "Basic " + toBase64(${credsExpr});
    const authHeader = request.headers.get("Authorization") ?? "";

    if (!timingSafeEqualStr(authHeader, expected)) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Protected Documentation"' },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
`;
}

/**
 * Vercel Edge Middleware を生成する（§3.4・§6.1）。
 * - mode "env": process.env（Vercel Environment Variables）から読む（vercel ターゲット用）。
 * - mode {user, pass}: dir/zip ターゲット用に直接埋め込む。
 */
export function generateVercelMiddleware(mode: "env" | AuthCredentials): string {
  const userExpr = mode === "env" ? "process.env.BASIC_AUTH_USER" : jsStringLiteral(mode.user);
  const passExpr = mode === "env" ? "process.env.BASIC_AUTH_PASS" : jsStringLiteral(mode.pass);

  return `${HELPERS_JS}

export function middleware(request) {
  const expected = "Basic " + toBase64(\`\${${userExpr}}:\${${passExpr}}\`);
  const authHeader = request.headers.get("authorization") ?? "";

  if (!timingSafeEqualStr(authHeader, expected)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Protected Documentation"' },
    });
  }
}

export const config = {
  matcher: "/((?!_next/static).*)",
};
`;
}
