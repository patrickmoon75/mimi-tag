import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { userClient } from "@/lib/supabase";

/** 안전한 내부 경로만 되돌아갈 곳으로 허용한다(외부 주소로 튕기는 공격 방지) */
function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/me";
}

async function signInWithKakao(formData: FormData) {
  "use server";
  const next = safeNext(String(formData.get("next") ?? ""));
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `https://${h.get("host")}`;
  const supabase = await userClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "kakao",
    options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  redirect(data.url);
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <div className="stack">
      <h1>로그인</h1>
      <p className="muted">내 물건을 등록하고 관리하려면 로그인이 필요해요. 이름·생년월일 같은 정보는 받지 않아요.</p>
      {error && <p className="error">로그인에 실패했어요. 다시 시도해 주세요.</p>}
      <form action={signInWithKakao}>
        <input type="hidden" name="next" value={safeNext(next)} />
        <button type="submit" className="btn">카카오로 시작하기</button>
      </form>
    </div>
  );
}
