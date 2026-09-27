import Link from "next/link";
import { redirect } from "next/navigation";
import { adminClient, currentUserId, userClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function accept(token: string) {
  "use server";
  const uid = await currentUserId();
  if (!uid) redirect(`/login?next=/t/${token}`);
  const supabase = await userClient();
  const { data: assetId, error } = await supabase.rpc("accept_transfer", { p_token: token });
  if (error || !assetId) redirect(`/t/${token}?error=1`);
  const { data } = await adminClient().from("assets").select("tag_code").eq("id", assetId as string).single();
  redirect(`/${data?.tag_code}?step=received`);
}

/** 중고 판매 이전 링크. 구매자는 봉인된 구매증명을 확인한 뒤 수락한다. */
export default async function TransferPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  if (!/^[0-9a-f]{64}$/.test(token)) redirect("/");
  const db = adminClient();
  const { data: t } = await db.from("transfers")
    .select("asset_id, mode, hide_price, expires_at, accepted_at, cancelled_at")
    .eq("token", token).maybeSingle();
  const valid = t && !t.accepted_at && !t.cancelled_at && new Date(t.expires_at) > new Date();
  if (!valid) {
    return (
      <div className="stack">
        <h1>유효하지 않은 링크예요</h1>
        <p className="muted">이미 처리되었거나 만료된 요청이에요.</p>
        <Link href="/" className="btn secondary">처음으로</Link>
      </div>
    );
  }
  const [{ data: asset }, { data: proof }, { data: events }] = await Promise.all([
    db.from("assets").select("name, category, created_at, seal_at").eq("id", t.asset_id).single(),
    db.from("proofs").select("store, purchased_on, price_krw, warranty").eq("asset_id", t.asset_id).maybeSingle(),
    db.from("ownership_events").select("kind, created_at").eq("asset_id", t.asset_id).order("created_at"),
  ]);
  const sealed = asset ? new Date(asset.seal_at) <= new Date() : false;
  const loggedIn = (await currentUserId()) !== null;

  return (
    <div className="stack">
      <h1>{t.mode === "sale" ? "구매한 물건의 기록 받기" : "선물 받기"}</h1>
      <section className="card">
        <h2>{asset?.name}</h2>
        {proof ? (
          <dl className="kv">
            <dt>구매처</dt><dd>{proof.store ?? "-"}</dd>
            <dt>구매일</dt><dd>{proof.purchased_on ?? "-"}</dd>
            <dt>금액</dt><dd>{t.hide_price || proof.price_krw == null ? "숨김" : `${proof.price_krw.toLocaleString("ko-KR")}원`}</dd>
            <dt>보증기간</dt><dd>{proof.warranty ?? "-"}</dd>
            <dt>소유자 변경</dt><dd>{Math.max(0, (events?.length ?? 1) - 1)}회</dd>
          </dl>
        ) : <p className="muted">구매증명이 등록되지 않은 물건이에요.</p>}
        <p className={sealed ? "note" : "error"}>
          {sealed ? "봉인된 기록이에요. 등록 이후 누구도 수정하지 않았어요." : "아직 봉인 전인 기록이에요. 판매자가 수정할 수 있는 상태예요."}
        </p>
      </section>
      {error && <p className="error">받기에 실패했어요. 요청이 만료되었을 수 있어요.</p>}
      {loggedIn ? (
        <form action={accept.bind(null, token)}><button className="btn" type="submit">내 태그로 받기</button></form>
      ) : (
        <Link className="btn" href={`/login?next=/t/${token}`}>로그인하고 받기</Link>
      )}
    </div>
  );
}
