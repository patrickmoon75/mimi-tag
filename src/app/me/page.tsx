import Link from "next/link";
import { redirect } from "next/navigation";
import { adminClient, currentUserId } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function MyTags() {
  const uid = await currentUserId();
  if (!uid) redirect("/login?next=/me");
  const db = adminClient();
  const { data: assets } = await db
    .from("assets")
    .select("tag_code, name, category, use_proof, use_letter, use_lost_contact, status, seal_at, finder_threads(finder_messages(side, read_at))")
    .eq("owner_id", uid)
    .order("created_at", { ascending: false });

  const now = Date.now();
  return (
    <div className="stack">
      <h1>내 태그</h1>
      {(assets ?? []).length === 0 && (
        <p className="muted">아직 등록한 태그가 없어요. 태그를 카메라로 스캔해 시작해 보세요.</p>
      )}
      {(assets ?? []).map((a) => {
        const unread = (a.finder_threads ?? []).flatMap((t) => t.finder_messages ?? [])
          .filter((m) => m.side === "finder" && !m.read_at).length;
        const sealed = new Date(a.seal_at).getTime() <= now;
        const days = Math.ceil((new Date(a.seal_at).getTime() - now) / 86_400_000);
        return (
          <Link key={a.tag_code} href={`/${a.tag_code}`} className="card" style={{ textDecoration: "none" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{a.name}</strong>
              {a.status === "lost" ? <span className="badge dark">분실 신고 중</span>
                : sealed ? <span className="badge">봉인됨</span>
                : <span className="badge" style={{ color: "var(--accent)" }}>수정 가능 D-{days}</span>}
            </div>
            <div className="row">
              {a.use_proof && <span className="badge">구매증명</span>}
              {a.use_letter && <span className="badge">편지</span>}
              {a.use_lost_contact && <span className="badge">분실 연락</span>}
              {unread > 0 && <span className="badge dark">새 메시지 {unread}</span>}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
