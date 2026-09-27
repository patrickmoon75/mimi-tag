import { notFound } from "next/navigation";
import { adminClient } from "@/lib/supabase";
import { finderReply } from "@/app/[code]/actions";

export const dynamic = "force-dynamic";

/** 습득자 전용 대화 화면. 로그인 없이, 이 링크를 가진 사람만 볼 수 있다. 주인의 연락처는 없다. */
export default async function FinderThread({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();
  const db = adminClient();
  const { data: thread } = await db.from("finder_threads")
    .select("id, closed_at, finder_messages(side, body, created_at)")
    .eq("finder_token", token).maybeSingle();
  if (!thread) notFound();
  const msgs = [...(thread.finder_messages ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));

  return (
    <div className="stack">
      <h1>주인에게 메시지를 보냈어요</h1>
      <div className="info">이 화면의 주소를 저장해 두세요. 주인의 답장을 여기서 확인할 수 있어요. 주소를 가진 사람만 볼 수 있어요.</div>
      <ol className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {msgs.map((m, i) => (
          <li key={i} className="card" style={{ background: m.side === "owner" ? "var(--accent-bg)" : undefined }}>
            <span className="muted">{m.side === "owner" ? "주인" : "나"} · {new Date(m.created_at).toLocaleString("ko-KR")}</span>
            <p style={{ whiteSpace: "pre-wrap" }}>{m.body}</p>
          </li>
        ))}
      </ol>
      {!thread.closed_at && (
        <form action={finderReply.bind(null, token)} className="stack">
          <label className="field">추가 메시지<textarea name="body" maxLength={1000} style={{ minHeight: 90 }} /></label>
          <button className="btn secondary" type="submit">보내기</button>
        </form>
      )}
    </div>
  );
}
