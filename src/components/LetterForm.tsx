"use client";

import { useRef, useState } from "react";
import { saveLetter } from "@/app/[code]/actions";

const OCCASIONS = ["생일", "기념일", "감사", "응원", "축하"];
const TONES = ["다정하게", "담백하게", "유쾌하게"];
const STATIONERY = [
  { id: "forest", label: "숲" },
  { id: "rose", label: "장미" },
  { id: "sky", label: "하늘" },
  { id: "plain", label: "기본" },
];

export function LetterForm({ code, error }: { code: string; error?: string }) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [occasion, setOccasion] = useState("생일");
  const [tone, setTone] = useState("다정하게");
  const [story, setStory] = useState("");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  async function draft() {
    setBusy(true);
    setAiError(null);
    try {
      const res = await fetch("/api/ai-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, occasion, tone, story, recipient }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || !data.text) throw new Error(data.error ?? "초안을 만들지 못했어요");
      if (bodyRef.current) bodyRef.current.value = data.text;
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "초안을 만들지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={saveLetter.bind(null, code)} className="stack">
      <h1>선물 편지</h1>
      {error === "empty" && <p className="error">편지 내용을 적어 주세요.</p>}
      {error === "save" && <p className="error">저장하지 못했어요. 다시 시도해 주세요.</p>}
      <div className="grid2">
        <label className="field">받는 사람<input type="text" name="recipient" maxLength={30} value={recipient} onChange={(e) => setRecipient(e.target.value)} /></label>
        <label className="field">보내는 사람<input type="text" name="sender" maxLength={30} /></label>
      </div>

      <section className="card" aria-labelledby="ai-title">
        <h2 id="ai-title">AI 초안 도우미</h2>
        <p className="muted">상황과 말투를 고르면 초안을 써 드려요. 고친 뒤 등록하면 돼요.</p>
        <fieldset className="chips" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="muted" style={{ marginBottom: 6 }}>상황</legend>
          {OCCASIONS.map((o) => (
            <label key={o}><input type="radio" name="_occasion" checked={occasion === o} onChange={() => setOccasion(o)} /><span>{o}</span></label>
          ))}
        </fieldset>
        <fieldset className="chips" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="muted" style={{ marginBottom: 6 }}>말투</legend>
          {TONES.map((t) => (
            <label key={t}><input type="radio" name="_tone" checked={tone === t} onChange={() => setTone(t)} /><span>{t}</span></label>
          ))}
        </fieldset>
        <label className="field">꼭 넣고 싶은 이야기
          <input type="text" maxLength={200} value={story} onChange={(e) => setStory(e.target.value)} placeholder="예: 함께 간 첫 캠핑" />
        </label>
        <button type="button" className="btn accent" onClick={draft} disabled={busy}>{busy ? "쓰는 중…" : "초안 만들기"}</button>
        {aiError && <p className="error" role="alert">{aiError}</p>}
      </section>

      <label className="field">편지 내용<textarea ref={bodyRef} name="body" maxLength={4000} required placeholder="직접 쓰거나 AI 초안을 고쳐 보세요." /></label>

      <fieldset className="chips" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="muted" style={{ marginBottom: 6 }}>편지지</legend>
        {STATIONERY.map((s, i) => (
          <label key={s.id}><input type="radio" name="stationery" value={s.id} defaultChecked={i === 0} /><span>{s.label}</span></label>
        ))}
      </fieldset>
      <label className="inline"><input type="checkbox" name="font" value="hand" />손글씨 글꼴로 보여주기</label>
      <label className="field">사진(최대 5장)<input type="file" name="photos" accept="image/*" multiple /></label>
      <details>
        <summary>링크 추가(최대 5개)</summary>
        <div className="stack" style={{ marginTop: 10 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="grid2">
              <input type="text" name={`link_label_${i}`} placeholder="이름" aria-label={`링크 ${i} 이름`} maxLength={40} />
              <input type="url" name={`link_url_${i}`} placeholder="https://" aria-label={`링크 ${i} 주소`} maxLength={300} />
            </div>
          ))}
        </div>
      </details>
      <div className="note">편지도 정해진 기간이 지나면 봉인되어 고칠 수 없어요.</div>
      <button type="submit" className="btn">편지 등록</button>
    </form>
  );
}
