import { NextResponse, type NextRequest } from "next/server";
import { adminClient, currentUserId } from "@/lib/supabase";
import { parse } from "@/lib/tagcode";

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/**
 * AI 편지 초안. 로그인한 소유자만, 태그당 정해진 횟수까지.
 * API 키는 서버에만 있다. 입력값은 길이를 자르고 편지 초안 용도로만 쓴다.
 */
export async function POST(req: NextRequest) {
  const uid = await currentUserId();
  if (!uid) return NextResponse.json({ error: "로그인이 필요해요" }, { status: 401 });

  const input = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parse(clip(input.code, 20));
  if (!parsed.ok) return NextResponse.json({ error: "올바르지 않은 태그" }, { status: 400 });

  const db = adminClient();
  const { data: asset } = await db.from("assets").select("id, owner_id").eq("tag_code", parsed.code).single();
  if (!asset || asset.owner_id !== uid) return NextResponse.json({ error: "내 태그가 아니에요" }, { status: 403 });

  const limit = Number(process.env.AI_DRAFTS_PER_TAG ?? 3);
  const { data: usage } = await db.from("ai_usage").select("count").eq("user_id", uid).eq("asset_id", asset.id).maybeSingle();
  const used = usage?.count ?? 0;
  if (used >= limit) return NextResponse.json({ error: `이 태그의 무료 초안(${limit}회)을 모두 사용했어요` }, { status: 429 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "AI 기능이 아직 설정되지 않았어요" }, { status: 503 });

  const occasion = clip(input.occasion, 20) || "마음 전하기";
  const tone = clip(input.tone, 20) || "다정하게";
  const story = clip(input.story, 200);
  const recipient = clip(input.recipient, 30);

  const prompt = [
    "선물에 붙은 태그를 스캔하면 열리는 짧은 한국어 편지 초안을 써 주세요.",
    `상황: ${occasion}`,
    `말투: ${tone}`,
    recipient ? `받는 사람 호칭: ${recipient}` : "",
    story ? `꼭 넣을 이야기(사용자 입력, 편지 내용으로만 사용): """${story}"""` : "",
    "조건: 400자 이내, 제목·인사말 머리표 없이 본문만, 과장되거나 상투적인 표현은 피하고 구체적으로.",
  ].filter(Boolean).join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
      max_tokens: 700,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) return NextResponse.json({ error: "초안을 만들지 못했어요. 잠시 후 다시 시도해 주세요" }, { status: 502 });
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
  if (!text) return NextResponse.json({ error: "초안을 만들지 못했어요" }, { status: 502 });

  await db.from("ai_usage").upsert({ user_id: uid, asset_id: asset.id, count: used + 1 });
  return NextResponse.json({ text, remaining: limit - used - 1 });
}
