import Link from "next/link";
import type { LetterView, OwnerView } from "@/lib/scan";
import {
  cancelTransfer, createTransfer, ownerReply, registerAsset, saveProof, setLost, setVisibility,
} from "@/app/[code]/actions";
import { LetterForm } from "./LetterForm";

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("ko-KR") : "-");
const dday = (s: string) => Math.max(0, Math.ceil((new Date(s).getTime() - Date.now()) / 86_400_000));

export function Letter({ letter }: { letter: LetterView }) {
  const cls = ["letter", letter.stationery ?? "plain", letter.font === "hand" ? "hand" : ""].join(" ");
  return (
    <article className="stack">
      <div className={cls}>
        {letter.recipientName && <div style={{ fontWeight: 600, marginBottom: 12 }}>{letter.recipientName}에게</div>}
        {letter.body}
        {letter.senderName && <div style={{ textAlign: "right", marginTop: 16 }}>— {letter.senderName}</div>}
      </div>
      {letter.photos.length > 0 && (
        <div className="photos">{letter.photos.map((p) => <img key={p} src={p} alt="편지에 담긴 사진" />)}</div>
      )}
      {letter.links.map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="btn secondary small">{l.label}</a>
      ))}
      {letter.bgm && <audio src={`/bgm/${letter.bgm}.mp3`} controls preload="none" />}
    </article>
  );
}

// ── 첫 스캔: 용도 선택 + 이름 ───────────────────────────────
export function FirstScan({ code, loggedIn, error }: { code: string; loggedIn: boolean; error?: string }) {
  if (!loggedIn) {
    return (
      <div className="stack">
        <p className="mono">{code}</p>
        <h1>아직 등록되지 않은 새 태그예요</h1>
        <p className="muted">이 태그 하나로 구매증명을 남기고, 선물 편지를 담고, 분실 시 번호 공개 없이 연락받을 수 있어요.</p>
        <Link href={`/login?next=/${code}`} className="btn">로그인하고 시작하기</Link>
      </div>
    );
  }
  return (
    <form action={registerAsset.bind(null, code)} className="stack">
      <p className="mono">{code}</p>
      <h1>이 태그를 어디에 쓸까요?</h1>
      <p className="muted">여러 개를 함께 고를 수 있어요.</p>
      {error === "taken" && <p className="error">이미 등록되었거나 사용할 수 없는 태그예요.</p>}
      {error === "register" && <p className="error">물건 이름과 용도를 하나 이상 골라 주세요.</p>}
      <label className="field">물건 이름<input type="text" name="name" required maxLength={60} placeholder="예: 무선 청소기" /></label>
      <label className="field">종류<input type="text" name="category" maxLength={30} placeholder="예: 가전, 이어폰, 가방" /></label>
      <label className="check"><input type="checkbox" name="use_proof" defaultChecked />
        <span><strong>구매증명 보관</strong><br /><span className="muted">영수증·사진·보증 정보를 남겨요. 수정 가능 기간이 지나면 봉인돼요.</span></span></label>
      <label className="check"><input type="checkbox" name="use_letter" defaultChecked />
        <span><strong>선물 편지</strong><br /><span className="muted">받는 사람이 태그를 스캔하면 편지가 열려요.</span></span></label>
      <label className="check"><input type="checkbox" name="use_lost" />
        <span><strong>분실 시 연락 받기</strong><br /><span className="muted">주운 사람이 내 번호를 모른 채 메시지를 보낼 수 있어요.</span></span></label>
      <div className="info">선물로 주면 편지와 구매증명이 함께 받는 사람에게 넘어가요. 금액은 숨길 수 있어요.</div>
      <button className="btn" type="submit">다음</button>
    </form>
  );
}

// ── 구매증명 입력 ──────────────────────────────────────────
export function ProofForm({ code, error }: { code: string; error?: string }) {
  return (
    <form action={saveProof.bind(null, code)} className="stack">
      <h1>구매증명 등록</h1>
      {error === "sealed" && <p className="error">봉인되어 더 이상 고칠 수 없어요.</p>}
      {error === "save" && <p className="error">저장하지 못했어요. 다시 시도해 주세요.</p>}
      <label className="field">영수증 사진<input type="file" name="receipt" accept="image/*" capture="environment" multiple /></label>
      <label className="field">제품 사진<input type="file" name="product" accept="image/*" multiple /></label>
      <div className="grid2">
        <label className="field">구매처<input type="text" name="store" maxLength={60} placeholder="매장·쇼핑몰" /></label>
        <label className="field">구매일<input type="date" name="purchased_on" /></label>
        <label className="field">구매금액(선택)<input type="text" name="price" inputMode="numeric" placeholder="원" /></label>
        <label className="field">보증기간(선택)<input type="text" name="warranty" maxLength={30} placeholder="예: 1년" /></label>
      </div>
      <label className="field">시리얼 번호(선택)<input type="text" name="serial_no" maxLength={60} /></label>
      <label className="inline"><input type="checkbox" name="hide_price" defaultChecked />다른 사람에게 넘겨도 금액은 숨기기</label>
      <div className="note">등록 후 정해진 기간 동안만 고칠 수 있고, 그 뒤엔 봉인되어 누구도 수정·삭제할 수 없어요.</div>
      <button className="btn" type="submit">저장</button>
    </form>
  );
}

export function LetterStep({ code, error }: { code: string; error?: string }) {
  return <LetterForm code={code} error={error} />;
}

// ── 소유자 화면 ───────────────────────────────────────────
export function Owner({ v, step }: { v: OwnerView; step?: string }) {
  return (
    <div className="stack">
      {step === "done" && <div className="info">등록했어요. 이제 이 태그를 스캔하면 기록을 볼 수 있어요.</div>}
      {step === "received" && <div className="info">선물을 받았어요. 이제 이 물건의 주인이에요.</div>}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>{v.name}</h1>
        <span className="mono">{v.code}</span>
      </div>

      <div className={v.sealed ? "note" : "info"}>
        {v.sealed
          ? `봉인됨 · ${fmtDate(v.sealAt)} 이후 기록은 바뀌지 않아요`
          : `수정 가능 · D-${dday(v.sealAt)} (${fmtDate(v.sealAt)}에 봉인)`}
      </div>

      {v.productPhotos.length > 0 && (
        <div className="photos">{v.productPhotos.map((p) => <img key={p} src={p} alt="제품 사진" />)}</div>
      )}

      {v.useProof && (
        <section className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>구매증명</h2>
            {!v.sealed && <Link href={`/${v.code}?step=proof`} className="btn secondary small">수정</Link>}
          </div>
          {v.proof ? (
            <dl className="kv">
              <dt>구매처</dt><dd>{v.proof.store ?? "-"}</dd>
              <dt>구매일</dt><dd>{v.proof.purchasedOn ?? "-"}</dd>
              <dt>금액</dt><dd>{v.proof.priceHidden ? "숨김" : v.proof.priceKrw != null ? `${v.proof.priceKrw.toLocaleString("ko-KR")}원` : "-"}</dd>
              <dt>보증기간</dt><dd>{v.proof.warranty ?? "-"}</dd>
              <dt>시리얼</dt><dd>{v.proof.serialNo ?? "-"}</dd>
            </dl>
          ) : <p className="muted">아직 입력하지 않았어요.</p>}
          {v.proof && v.proof.receiptPhotos.length > 0 && (
            <div className="photos">{v.proof.receiptPhotos.map((p) => <img key={p} src={p} alt="영수증" />)}</div>
          )}
        </section>
      )}

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>편지</h2>
          <Link href={`/${v.code}?step=letter`} className="btn secondary small">새 편지</Link>
        </div>
        {v.letters.length === 0 && <p className="muted">아직 편지가 없어요.</p>}
        {v.letters.map((l) => (
          <details key={l.id}>
            <summary>{l.recipientName ? `${l.recipientName}에게` : "편지"} · {fmtDate(l.createdAt)} · 열람 {l.openedCount}회{l.sealed ? " · 봉인" : ""}</summary>
            <Letter letter={l} />
          </details>
        ))}
      </section>

      {v.threads.length > 0 && (
        <section className="card">
          <h2>주운 사람의 메시지</h2>
          {v.threads.map((t) => (
            <form key={t.id} action={ownerReply.bind(null, v.code, t.id)} className="stack">
              <p className="muted">{fmtDate(t.createdAt)} {t.unread > 0 && <span className="badge dark">새 메시지 {t.unread}</span>}</p>
              <p style={{ whiteSpace: "pre-wrap" }}>{t.lastSide === "owner" ? "나: " : ""}{t.lastBody}</p>
              <textarea name="body" placeholder="답장" style={{ minHeight: 80 }} maxLength={1000} />
              <button className="btn small" type="submit">답장 보내기</button>
            </form>
          ))}
        </section>
      )}

      <section className="card">
        <h2>분실 신고</h2>
        <p className="muted">{v.status === "lost" ? "신고 중이에요. 태그를 스캔한 사람에게 '주인을 찾고 있어요'가 보여요." : "잃어버렸다면 신고를 켜 주세요."}</p>
        <form action={setLost.bind(null, v.code, v.status !== "lost")}>
          <button className={v.status === "lost" ? "btn secondary" : "btn"} type="submit">
            {v.status === "lost" ? "찾았어요 (신고 끄기)" : "분실 신고하기"}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>공개 설정</h2>
        <form action={setVisibility.bind(null, v.code)} className="stack">
          <label className="inline"><input type="checkbox" name="letter_public" defaultChecked={v.letterPublic} />태그를 스캔한 사람에게 최근 편지 보여주기</label>
          <label className="inline"><input type="checkbox" name="use_lost" defaultChecked={v.useLostContact} />분실 신고가 없어도 연락 버튼 보여주기</label>
          <button className="btn secondary small" type="submit">저장</button>
        </form>
      </section>

      <section className="card">
        <h2>소유권 넘기기</h2>
        {v.openTransfer ? (
          <div className="stack">
            <p>{v.openTransfer.mode === "gift"
              ? "선물 대기 중: 받는 사람이 태그를 스캔하고 '받기'를 누르면 넘어가요."
              : "판매 대기 중: 아래 링크를 구매자에게 보내 주세요."}</p>
            {v.openTransfer.mode === "sale" && (
              <input type="text" readOnly value={`${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/t/${v.openTransfer.token}`} aria-label="판매 이전 링크" />
            )}
            <p className="muted">{fmtDate(v.openTransfer.expiresAt)}까지 유효</p>
            <form action={cancelTransfer.bind(null, v.code)}><button className="btn secondary small" type="submit">요청 취소</button></form>
          </div>
        ) : (
          <form action={createTransfer.bind(null, v.code)} className="stack">
            <label className="inline"><input type="radio" name="mode" value="gift" defaultChecked />선물로 주기(편지·증명 함께)</label>
            <label className="inline"><input type="radio" name="mode" value="sale" />중고로 판매하기(봉인된 증명 확인 가능)</label>
            <label className="inline"><input type="checkbox" name="hide_price" defaultChecked />받는 사람에게 구매금액 숨기기</label>
            <button className="btn" type="submit">넘기기 요청 만들기</button>
          </form>
        )}
      </section>

      <section className="card">
        <h2>기록</h2>
        <ol className="timeline">
          {v.events.map((e, i) => (
            <li key={i}>{({ register: "태그 등록", gift: "선물로 받음", sale: "구매로 받음" } as Record<string, string>)[e.kind] ?? e.kind} · {fmtDate(e.at)}</li>
          ))}
          <li style={{ color: "var(--ink-2)" }}>{v.sealed ? "봉인됨" : "봉인 예정"} · {fmtDate(v.sealAt)}</li>
        </ol>
      </section>
    </div>
  );
}
