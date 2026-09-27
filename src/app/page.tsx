import Link from "next/link";
import { redirect } from "next/navigation";
import { adminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * 레떼즈 기존 QR(lettez.net/?sno=XXXXXXXXXXXXXXXX) 호환:
 * lettez.net 을 이 앱으로 연결하면, 이관된 코드는 새 태그 주소로 넘겨준다.
 */
export default async function Home({ searchParams }: { searchParams: Promise<{ sno?: string }> }) {
  const { sno } = await searchParams;
  if (sno && /^[0-9A-Za-z]{16}$/.test(sno)) {
    const { data } = await adminClient().from("tags").select("code").eq("legacy_sno", sno).maybeSingle();
    if (data) redirect(`/${data.code}`);
  }
  return (
    <div className="stack">
      <h1>붙이는 순간, 물건의 디지털 프로필</h1>
      <p className="muted">
        작은 QR 태그 하나로 구매증명을 남기고, 선물에 편지를 담고, 잃어버렸을 때 번호 공개 없이 연락받을 수 있어요.
      </p>
      <div className="note">태그를 스마트폰 카메라로 비추면 바로 시작돼요. 앱 설치는 필요 없어요.</div>
      <Link href="/me" className="btn secondary">내 태그 보기</Link>
    </div>
  );
}
