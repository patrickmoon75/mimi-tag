/**
 * 태그 발급 묶음 만들기 (관리자용 명령줄 도구)
 *
 *   npm run issue -- --type S --qty 100 --product "다이소 8매 세트" --target 다이소 [--partner 납품처] [--country KR]
 *
 * - 코드를 암호학적 난수로 만들어 DB 에 넣고, 인쇄용 CSV(code,url) 를 output/ 에 저장한다.
 * - CSV 의 url 은 전부 대문자라 QR 영숫자 모드로 인쇄된다(칸 수 최소화).
 *   라벨 프린터 프로그램에서 url 열을 QR 로 지정하면 된다.
 * - 필요 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TAG_HOST
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { ISSUE_TYPES, generateMany, minQrVersion, modulesFor, tagUrl, type IssueType } from "../src/lib/tagcode";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const type = (arg("type") ?? "S").toUpperCase() as IssueType;
  const qty = Number(arg("qty"));
  const product = arg("product");
  const host = process.env.TAG_HOST;
  if (!ISSUE_TYPES.includes(type)) throw new Error("--type 은 S, P, M 중 하나");
  if (!Number.isInteger(qty) || qty < 1 || qty > 100000) throw new Error("--qty 는 1~100000");
  if (!product) throw new Error("--product 필요");
  if (!host) throw new Error("TAG_HOST 환경변수 필요");

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: batch, error } = await db.from("batches").insert({
    issue_type: type, quantity: qty, product_name: product,
    target: arg("target") ?? null, partner: arg("partner") ?? null, country: arg("country") ?? "KR",
  }).select("id").single();
  if (error || !batch) throw error ?? new Error("묶음 생성 실패");

  const rb = (n: number) => new Uint8Array(randomBytes(n));
  const codes: string[] = [];
  // DB 유일 제약에 걸리면(극히 드묾) 그만큼 다시 만든다
  while (codes.length < qty) {
    const chunk = generateMany(type, Math.min(1000, qty - codes.length), rb);
    const { data, error: e } = await db.from("tags")
      .upsert(chunk.map((code) => ({ code, batch_id: batch.id })), { onConflict: "code", ignoreDuplicates: true })
      .select("code");
    if (e) throw e;
    codes.push(...(data ?? []).map((r) => r.code as string));
  }

  mkdirSync("output", { recursive: true });
  const file = `output/batch-${batch.id}-${type}-${qty}.csv`;
  writeFileSync(file, "code,url\n" + codes.map((c) => `${c},${tagUrl(c, host)}`).join("\n") + "\n");

  const sample = tagUrl(codes[0], host);
  const v = minQrVersion(sample, "M");
  console.log(`묶음 #${batch.id}: ${codes.length}개 발급 → ${file}`);
  console.log(`QR 예시 ${sample} → 버전 ${v} (${v ? modulesFor(v) : "?"}칸), 오류정정 M`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
