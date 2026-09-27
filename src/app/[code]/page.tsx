import Link from "next/link";
import { resolveScan } from "@/lib/scan";
import { FirstScan, Letter, LetterStep, Owner, ProofForm } from "@/components/views";
import { acceptGiftByTag, sendFinderMessage } from "./actions";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ step?: string; error?: string }>;
};

export default async function TagPage({ params, searchParams }: Props) {
  const { code: raw } = await params;
  const { step, error } = await searchParams;
  const v = await resolveScan(raw);

  switch (v.kind) {
    case "invalid":
      return <Message title="올바르지 않은 태그예요" body="주소를 다시 확인하거나 태그를 다시 스캔해 주세요." />;
    case "unavailable":
      return <Message title="사용할 수 없는 태그예요" body="발급되지 않았거나 폐기된 태그예요." />;
    case "rate_limited":
      return <Message title="잠시 후 다시 시도해 주세요" body="짧은 시간에 요청이 너무 많았어요." />;
    case "unregistered":
      return <FirstScan code={v.code} loggedIn={v.loggedIn} error={error} />;

    case "owner":
      if (step === "proof" && !v.sealed) return <ProofForm code={v.code} error={error} />;
      if (step === "letter") return <LetterStep code={v.code} error={error} />;
      return <Owner v={v} step={step} />;

    case "gift":
      return (
        <div className="stack">
          <h1>선물이 도착했어요</h1>
          {v.letter ? <Letter letter={v.letter} /> : <p className="muted">편지는 없지만 선물의 기록을 받을 수 있어요.</p>}
          {v.proof && (
            <section className="info stack">
              <strong>이 선물의 구매증명도 함께 받을 수 있어요</strong>
              <dl className="kv">
                <dt>제품</dt><dd>{v.name}</dd>
                <dt>구매일</dt><dd>{v.proof.purchasedOn ?? "-"}</dd>
                <dt>보증기간</dt><dd>{v.proof.warranty ?? "-"}</dd>
                <dt>금액</dt><dd>숨김</dd>
              </dl>
            </section>
          )}
          {error === "transfer" && <p className="error">받기에 실패했어요. 요청이 만료되었을 수 있어요.</p>}
          {v.loggedIn ? (
            <form action={acceptGiftByTag.bind(null, v.code)}>
              <button className="btn" type="submit">내 태그로 받기</button>
            </form>
          ) : (
            <Link className="btn" href={`/login?next=/${v.code}`}>로그인하고 내 태그로 받기</Link>
          )}
          <p className="muted">받으면 주인이 나로 바뀌고, 기존 기록은 그대로 남아요.</p>
        </div>
      );

    case "lost":
      return (
        <form action={sendFinderMessage.bind(null, v.code)} className="stack">
          <span className="badge dark" style={{ alignSelf: "flex-start" }}>분실 신고된 물건</span>
          <h1>주인을 찾고 있어요</h1>
          <p className="muted">주워 주셔서 고마워요. 주인에게 소식을 전해 주세요.</p>
          <div className="card row">
            {v.photo && <img src={v.photo} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8 }} />}
            <div><strong>{v.name}</strong>{v.category && <p className="muted">{v.category}</p>}</div>
          </div>
          <FinderFields />
        </form>
      );

    case "public":
      return (
        <div className="stack">
          {v.letter ? <Letter letter={v.letter} /> : <h1>{v.name}</h1>}
          {v.lostContact && (
            <details className="card">
              <summary>이 물건을 주우셨나요? 주인에게 연락하기</summary>
              <form action={sendFinderMessage.bind(null, v.code)} className="stack" style={{ marginTop: 12 }}>
                <FinderFields />
              </form>
            </details>
          )}
          {v.banner?.link && (
            <a href={v.banner.link} target="_blank" rel="noopener noreferrer sponsored" className="card">
              {v.banner.image ? <img src={v.banner.image} alt="제휴 매장 배너" style={{ width: "100%", borderRadius: 8 }} /> : "제휴 매장 보기"}
            </a>
          )}
        </div>
      );
  }
}

function FinderFields() {
  return (
    <>
      <div className="note">주인의 연락처는 보이지 않아요. 메시지는 미미태그를 거쳐 전달되고, 답장은 다음 화면의 링크에서 확인할 수 있어요.</div>
      <fieldset className="chips" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="muted" style={{ marginBottom: 6 }}>빠른 답변</legend>
        {["제가 보관하고 있어요", "근처 가게에 맡겼어요", "경찰서·유실물센터에 맡겼어요"].map((q, i) => (
          <label key={q}><input type="radio" name="quick" value={q} defaultChecked={i === 0} /><span>{q}</span></label>
        ))}
      </fieldset>
      <label className="field">메시지<textarea name="body" maxLength={900} placeholder="찾은 장소나 돌려줄 방법을 적어 주세요." style={{ minHeight: 110 }} /></label>
      <button className="btn" type="submit">주인에게 메시지 보내기</button>
      <p className="muted" style={{ textAlign: "center" }}>로그인 없이 보낼 수 있어요</p>
    </>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="stack">
      <h1>{title}</h1>
      <p className="muted">{body}</p>
      <Link href="/" className="btn secondary">처음으로</Link>
    </div>
  );
}
